import { project, type OverpassElement } from './osm'

export const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]
export const RADIUS_M = 250
// Larger than RADIUS_M so a cached result still covers RADIUS_M around a click up to REUSE_M away.
const QUERY_RADIUS_M = 350
const REUSE_M = 100
const ENDPOINT_TIMEOUT_MS = 15000

export interface FetchOptions {
  signal?: AbortSignal
  fetchFn?: typeof fetch
  endpoints?: string[]
  timeoutMs?: number
}

const cache = new Map<string, { lat: number; lon: number; elements: OverpassElement[] }>()

export function clearOverpassCache() {
  cache.clear()
}

function cached(lat: number, lon: number): OverpassElement[] | undefined {
  for (const c of cache.values()) {
    const p = project(c.lat, c.lon, { lat, lon })
    if (Math.hypot(p.x, p.z) <= REUSE_M) return c.elements
  }
  return undefined
}

async function queryEndpoint(
  url: string,
  query: string,
  { signal, fetchFn = fetch, timeoutMs = ENDPOINT_TIMEOUT_MS }: FetchOptions,
): Promise<OverpassElement[]> {
  const guard = AbortSignal.timeout(timeoutMs)
  let res: Response
  try {
    res = await fetchFn(url, {
      method: 'POST',
      body: new URLSearchParams({ data: query }),
      signal: signal ? AbortSignal.any([signal, guard]) : guard,
    })
  } catch {
    throw new Error(guard.aborted ? 'timed out' : 'network error')
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  let json: { elements?: OverpassElement[]; remark?: string }
  try {
    json = await res.json()
  } catch {
    throw new Error(guard.aborted ? 'timed out' : 'invalid response')
  }
  const elements = json.elements ?? []
  // An overloaded server answers 200 with no elements and a "runtime error" remark.
  if (!elements.length && /error|timed out/i.test(json.remark ?? '')) throw new Error(json.remark)
  return elements
}

/** Tries the endpoints one after the other; a caller abort rejects with its AbortError. */
export async function fetchBuildingElements(
  lat: number,
  lon: number,
  options: FetchOptions = {},
): Promise<OverpassElement[]> {
  const hit = cached(lat, lon)
  if (hit) return hit
  const around = `(around:${QUERY_RADIUS_M},${lat},${lon})`
  const query =
    `[out:json][timeout:20];(way["building"]${around};relation["building"]${around};` +
    `way["building:part"]${around};relation["building:part"]${around};` +
    // Green areas and mapped trees, for the tree scatter (src/trees.ts); parseOverpass ignores them.
    `way["leisure"~"^(park|garden)$"]${around};relation["leisure"~"^(park|garden)$"]${around};` +
    `way["landuse"~"^(grass|forest|meadow|village_green)$"]${around};relation["landuse"~"^(grass|forest|meadow|village_green)$"]${around};` +
    `way["natural"~"^(wood|scrub|tree_row)$"]${around};relation["natural"~"^(wood|scrub)$"]${around};` +
    `node["natural"="tree"]${around};);out geom;`
  let last = ''
  for (const url of options.endpoints ?? ENDPOINTS) {
    try {
      const elements = await queryEndpoint(url, query, options)
      cache.set(`${lat.toFixed(4)},${lon.toFixed(4)}`, { lat, lon, elements })
      return elements
    } catch (err) {
      options.signal?.throwIfAborted()
      last = (err as Error).message
    }
  }
  throw new Error(`OpenStreetMap servers are unavailable right now (${last}).`)
}
