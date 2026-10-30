import { project, type OverpassElement } from './osm'
import { t } from './i18n'

export const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]
/** Neighbour radius when the caller does not say (see `NEIGHBORHOODS` in neighborhood.ts). */
export const RADIUS_M = 350
// The query reaches REUSE_M beyond the radius asked for, so a cached result still covers that radius around a click up to REUSE_M away.
export const REUSE_M = 100
const ENDPOINT_TIMEOUT_MS = 15000

export interface FetchOptions {
  signal?: AbortSignal
  fetchFn?: typeof fetch
  endpoints?: string[]
  timeoutMs?: number
  /** Radius of neighbours to cover around the point (default RADIUS_M). */
  radiusM?: number
}

const cache = new Map<string, { lat: number; lon: number; queryRadius: number; elements: OverpassElement[] }>()

export function clearOverpassCache() {
  cache.clear()
}

/** A kept answer whose circle holds the whole `radiusM` circle around the point: a bigger answer serves smaller sizes too. */
function cached(lat: number, lon: number, radiusM: number): BuildingData | undefined {
  for (const c of cache.values()) {
    const p = project(c.lat, c.lon, { lat, lon })
    if (Math.hypot(p.x, p.z) + radiusM <= c.queryRadius) return { elements: c.elements, center: { lat: c.lat, lon: c.lon }, radius: c.queryRadius }
  }
  return undefined
}

/** An answer, and the circle it is complete for: everything within `radius` metres of `center` is in `elements`. */
export interface BuildingData {
  elements: OverpassElement[]
  center: { lat: number; lon: number }
  radius: number
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

export async function fetchBuildingElements(lat: number, lon: number, options: FetchOptions = {}): Promise<OverpassElement[]> {
  return (await fetchBuildingData(lat, lon, options)).elements
}

/** Tries the endpoints one after the other; a caller abort rejects with its AbortError. */
export async function fetchBuildingData(lat: number, lon: number, options: FetchOptions = {}): Promise<BuildingData> {
  const radiusM = options.radiusM ?? RADIUS_M
  const hit = cached(lat, lon, radiusM)
  if (hit) return hit
  const queryRadius = radiusM + REUSE_M
  const around = `(around:${queryRadius},${lat},${lon})`
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
      cache.set(`${lat.toFixed(4)},${lon.toFixed(4)}`, { lat, lon, queryRadius, elements })
      return { elements, center: { lat, lon }, radius: queryRadius }
    } catch (err) {
      options.signal?.throwIfAborted()
      last = (err as Error).message
    }
  }
  throw new Error(t('shell.osmDown', { reason: String(last) }))
}
