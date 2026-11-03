import { validatePlan } from './editor-geom'
import type { Plan } from './plan'
import type { View } from './ui'

/**
 * Share links: the picked point, the plan (Export JSON's data), the date, time and tab, deflated and written in the
 * URL hash (`#s=1.<base64url>`). The hash is never sent to a server. The leading number is the format version; a
 * newer or unknown one is refused with a friendly message instead of being guessed at.
 */
export interface Shared {
  lat: number
  lon: number
  view: View
  /** YYYY-MM-DD */
  date: string
  minutes: number
  plan: Plan
  /** Made from the bundled Milan example (reopened from the fixture, as the picker may be offline). */
  example?: boolean
}

export const SHARE_VERSION = 1
const PREFIX = '#s='
const VIEWS: readonly string[] = ['map', 'plan', '3d', 'panels', 'garden']
/** A link longer than this is more than any hash a browser or chat app should be asked to carry. */
const MAX_HASH = 60000

export type ShareError = 'version' | 'broken'

/** Coordinates keep 7 decimals (about a centimetre); every other number is rounded to a millimetre. */
const exact = (key: string) => key === 'lat' || key === 'lon'
const roundTo = (ll: number[]) =>
  function (this: unknown, key: string, v: unknown) {
    return typeof v === 'number' && this !== ll && !exact(key) ? Math.round(v * 1000) / 1000 : v
  }

const toBase64Url = (bytes: Uint8Array) => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const fromBase64Url = (text: string) => {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('alphabet')
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

export const canCompress = () => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined'

async function run(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([data as BlobPart]).stream().pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>)
  return new Uint8Array(await new Response(out).arrayBuffer())
}

/**
 * The hash for a share, `#s=1.<deflate-raw, base64url>`; `#s=1u.<plain base64url>` where the browser has no
 * CompressionStream (the link is longer, and opens everywhere).
 */
export async function encodeShare(s: Shared): Promise<string> {
  const { version: _, ...plan } = s.plan
  const ll = [s.lat, s.lon]
  const json = JSON.stringify({ ll, d: s.date, m: s.minutes, t: s.view, ...(s.example && { x: 1 }), p: plan }, roundTo(ll))
  const bytes = new TextEncoder().encode(json)
  if (!canCompress()) return `${PREFIX}${SHARE_VERSION}u.${toBase64Url(bytes)}`
  return `${PREFIX}${SHARE_VERSION}.${toBase64Url(await run(bytes, new CompressionStream('deflate-raw')))}`
}

/** The share a hash holds, or why not: `version` for a format this build does not know, `broken` for anything else. */
export async function decodeShare(hash: string): Promise<{ share: Shared } | { error: ShareError }> {
  if (!hash.startsWith(PREFIX)) return { error: 'broken' }
  const body = hash.slice(PREFIX.length)
  const dot = body.indexOf('.')
  const tag = body.slice(0, dot)
  if (dot < 0 || !/^\d+u?$/.test(tag) || hash.length > MAX_HASH) return { error: 'broken' }
  if (parseInt(tag, 10) !== SHARE_VERSION) return { error: 'version' }
  try {
    let bytes = fromBase64Url(body.slice(dot + 1))
    if (!tag.endsWith('u')) {
      if (!canCompress()) return { error: 'broken' }
      bytes = await run(bytes, new DecompressionStream('deflate-raw'))
    }
    return fromPayload(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
  } catch {
    return { error: 'broken' }
  }
}

function fromPayload(v: unknown): { share: Shared } | { error: ShareError } {
  const o = v as { ll?: unknown; d?: unknown; m?: unknown; t?: unknown; x?: unknown; p?: unknown } | null
  if (!o || typeof o !== 'object' || !Array.isArray(o.ll)) return { error: 'broken' }
  const [lat, lon] = o.ll as number[]
  const ok =
    Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lon) && Math.abs(lon) <= 180 &&
    typeof o.t === 'string' && VIEWS.includes(o.t) &&
    typeof o.d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.d) &&
    typeof o.m === 'number' && Number.isFinite(o.m) && o.m >= 0 && o.m < 1440
  if (!ok) return { error: 'broken' }
  const checked = validatePlan({ version: 1, ...(o.p as object) })
  if ('error' in checked) return { error: 'broken' }
  return { share: { lat, lon, view: o.t as View, date: o.d as string, minutes: o.m as number, plan: checked.plan, ...(o.x === 1 && { example: true }) } }
}

/** The full link for the page being viewed, with any old hash replaced. */
export const shareUrl = (hash: string): string => `${location.origin}${location.pathname}${hash}`
