import type { Lang } from './i18n'
import type { Plant } from './plants'

// The plant card's outside information: a picture and a short text from Wikipedia (REST summary), the picture's author and
// licence from Wikimedia Commons, and care links. Only the plant's article title is ever sent, never a location.
// Fetched only when a card opens, cached in memory and in sessionStorage by language and title.

export interface Credit {
  /** Plain text, no markup; absent when Commons has no author. */
  artist?: string
  license?: string
  licenseUrl?: string
  /** The file's Commons page; absent when the picture is not on Commons. */
  fileUrl?: string
}

export interface PlantInfo {
  title: string
  extract: string
  pageUrl: string
  image?: { src: string; width: number; height: number }
  credit?: Credit
}

export interface CareLink {
  label: 'wikipedia' | 'rhs'
  url: string
}

type Fetch = typeof fetch

const underscored = (title: string): string => title.trim().replace(/ /g, '_')

export const articleUrl = (lang: Lang, title: string): string => `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(underscored(title))}`

export const summaryUrl = (lang: Lang, title: string): string =>
  `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(underscored(title))}`

export const commonsFileUrl = (file: string): string => `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(underscored(file))}`

export const commonsInfoUrl = (file: string): string =>
  `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(`File:${underscored(file)}`)}&prop=imageinfo&iiprop=extmetadata&format=json&origin=*`

/** The Commons file name behind an upload.wikimedia.org picture URL (original or thumbnail), or undefined for a non-Commons file. */
export function commonsFileName(src: string): string | undefined {
  const m = /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/(thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/]+)/.exec(src)
  if (!m) return undefined
  try {
    return decodeURIComponent(m[2])
  } catch {
    return undefined
  }
}

/** The care links: the plant's Wikipedia article in the app's language, and for English an RHS search by plant name. */
export function careLinks(plant: Plant, lang: Lang): CareLink[] {
  const links: CareLink[] = [{ label: 'wikipedia', url: articleUrl(lang, plant.wiki[lang]) }]
  if (lang === 'en') links.push({ label: 'rhs', url: `https://www.rhs.org.uk/search?query=${encodeURIComponent(plant.name)}` })
  return links
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/** Commons metadata values are HTML: keep the text only. */
export function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : all
      }
      return ENTITIES[e.toLowerCase()] ?? all
    })
    .replace(/\s+/g, ' ')
    .trim()
}

/** Author, licence and licence link from a Commons `extmetadata` object; fields that are missing stay out. */
export function creditFrom(extmetadata: unknown, fileUrl?: string): Credit {
  const meta = (extmetadata ?? {}) as Record<string, { value?: unknown } | undefined>
  const text = (key: string): string | undefined => {
    const v = meta[key]?.value
    const s = typeof v === 'string' ? plainText(v) : ''
    return s === '' ? undefined : s
  }
  const url = text('LicenseUrl')
  return {
    artist: text('Artist'),
    license: text('LicenseShortName'),
    licenseUrl: url && /^https?:\/\//.test(url) ? url : undefined,
    fileUrl,
  }
}

/** The credit line as plain text, the way the card words it: "Photo: Jane Doe, CC BY-SA 4.0 · Wikimedia Commons". */
export function creditText(credit: Credit, photo: string): string {
  const who = [credit.artist, credit.license].filter(Boolean).join(', ')
  return `${who ? `${photo}: ${who} · ` : ''}Wikimedia Commons`
}

interface Summary {
  type?: string
  title?: string
  extract?: string
  thumbnail?: { source?: string; width?: number; height?: number }
  content_urls?: { desktop?: { page?: string } }
}

const memory = new Map<string, PlantInfo>()
const pending = new Map<string, Promise<PlantInfo>>()
const cacheKey = (lang: Lang, title: string): string => `sunpatch.wiki.${lang}.${title}`

function readSession(key: string): PlantInfo | undefined {
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? (JSON.parse(raw) as PlantInfo) : undefined
  } catch {
    return undefined
  }
}

function writeSession(key: string, info: PlantInfo) {
  try {
    sessionStorage.setItem(key, JSON.stringify(info))
  } catch {
    /* storage can be blocked or full */
  }
}

async function getJson(fetchFn: Fetch, url: string): Promise<unknown> {
  const res = await fetchFn(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function fetchInfo(lang: Lang, title: string, fetchFn: Fetch): Promise<PlantInfo> {
  const s = (await getJson(fetchFn, summaryUrl(lang, title))) as Summary
  const extract = typeof s.extract === 'string' && s.type !== 'disambiguation' ? s.extract.trim() : ''
  if (extract === '') throw new Error('no summary')
  const info: PlantInfo = { title: s.title ?? title, extract, pageUrl: s.content_urls?.desktop?.page ?? articleUrl(lang, title) }
  const thumb = s.thumbnail
  if (thumb?.source && /^https:\/\/upload\.wikimedia\.org\//.test(thumb.source)) {
    info.image = { src: thumb.source, width: thumb.width ?? 320, height: thumb.height ?? 240 }
    const file = commonsFileName(thumb.source)
    if (file) {
      const fileUrl = commonsFileUrl(file)
      try {
        const data = (await getJson(fetchFn, commonsInfoUrl(file))) as { query?: { pages?: Record<string, { imageinfo?: { extmetadata?: unknown }[] }> } }
        const page = Object.values(data.query?.pages ?? {})[0]
        info.credit = creditFrom(page?.imageinfo?.[0]?.extmetadata, fileUrl)
      } catch {
        info.credit = { fileUrl } // the picture still shows, credited to Commons with the file link
      }
    }
  }
  return info
}

/** The Wikipedia summary and picture credit for a title; rejects when Wikipedia cannot be reached or has no usable summary. */
export function loadPlantInfo(lang: Lang, title: string, fetchFn: Fetch = (...a) => fetch(...a)): Promise<PlantInfo> {
  const key = cacheKey(lang, title)
  const hit = memory.get(key) ?? readSession(key)
  if (hit) {
    memory.set(key, hit)
    return Promise.resolve(hit)
  }
  const again = pending.get(key)
  if (again) return again
  const p = fetchInfo(lang, title, fetchFn)
    .then((info) => {
      memory.set(key, info)
      writeSession(key, info)
      return info
    })
    .finally(() => pending.delete(key))
  pending.set(key, p)
  return p
}

/** Forget both caches (tests). */
export const clearPlantInfoCache = (): void => {
  memory.clear()
  pending.clear()
  try {
    for (const k of Object.keys(sessionStorage)) if (k.startsWith('sunpatch.wiki.')) sessionStorage.removeItem(k)
  } catch {
    /* no storage */
  }
}
