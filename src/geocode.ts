import { distanceToRing, MAX_SNAP_M, pointInPolygon, project, ringArea } from './osm'

const NOMINATIM = 'https://nominatim.openstreetmap.org/search'

export interface PolygonFeature {
  type: 'Feature'
  properties: Record<string, never>
  geometry: { type: string; coordinates: unknown }
}

export interface GeoHit {
  lat: string
  lon: string
  display_name: string
  category?: string
  type?: string
  addresstype?: string
  address?: { house_number?: string; road?: string }
  boundingbox?: [string, string, string, string] // south, north, west, east
  geojson?: { type: string; coordinates: unknown }
}

/** bounds is [west, south, east, north]. */
export function searchUrl(q: string, bounds?: [number, number, number, number], lang?: string): string {
  const p = new URLSearchParams({
    q,
    format: 'jsonv2',
    limit: '6',
    addressdetails: '1',
    polygon_geojson: '1',
    polygon_threshold: '0.00001',
  })
  if (lang) p.set('accept-language', lang)
  if (bounds) {
    p.set('viewbox', bounds.join(','))
    p.set('bounded', '0')
  }
  return `${NOMINATIM}?${p}`
}

export function isBuildingLike(hit: GeoHit): boolean {
  const kinds = ['building', 'house', 'residential', 'apartments', 'yes']
  return hit.category === 'building' || kinds.includes(hit.addresstype ?? '') || kinds.includes(hit.type ?? '')
}

/** Zoom 18 for address/building hits, otherwise fit the bounding box when there is one. */
export function viewFor(hit: GeoHit):
  | { zoom: number }
  | { bounds: [number, number, number, number] } {
  if (isBuildingLike(hit) || !hit.boundingbox) return { zoom: 18 }
  const [s, n, w, e] = hit.boundingbox.map(Number)
  if (s === n && w === e) return { zoom: 18 }
  return { bounds: [w, s, e, n] }
}

export function polygonFeature(hit: GeoHit): PolygonFeature | null {
  const g = hit.geojson
  if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) return null
  return { type: 'Feature', properties: {}, geometry: g }
}

/** House number typed in a query ("via Arbe 34 Milano" -> "34", "via Roma 12/b" -> "12/b"); postcodes do not count. */
export function requestedHouseNumber(q: string): string | undefined {
  const tokens = q.split(/[\s,]+/).filter((t) => /^\d{1,4}([a-z]|\/[a-z0-9]{1,2})?$/i.test(t))
  return tokens[tokens.length - 1]
}

const normalNumber = (n: string) => n.toLowerCase().replace(/[\s/]/g, '')

/** A street, not a house: Nominatim falls back to the street when it does not know the number. */
export function isStreetLevel(hit: GeoHit): boolean {
  return !hit.address?.house_number && (hit.category === 'highway' || hit.addresstype === 'road')
}

export type NumberMatch = 'exact' | 'other' | 'street' | 'none'

/** How a hit relates to the house number asked for: its own number, another number, the bare street, or no number to compare. */
export function numberMatch(hit: GeoHit, number: string | undefined): NumberMatch {
  if (!number) return 'none'
  const own = hit.address?.house_number
  if (own) return normalNumber(own) === normalNumber(number) ? 'exact' : 'other'
  return isStreetLevel(hit) ? 'street' : 'none'
}

const RANK: Record<NumberMatch, number> = { exact: 0, none: 1, other: 2, street: 3 }

/** With a house number in the query: exact matches first, bare streets last. Otherwise Nominatim's order. */
export function rankHits(hits: GeoHit[], q: string): GeoHit[] {
  const number = requestedHouseNumber(q)
  if (!number) return hits
  return hits
    .map((hit, i) => ({ hit, i, rank: RANK[numberMatch(hit, number)] }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((r) => r.hit)
}

export function hitLabel(hit: GeoHit, q = ''): string {
  const number = requestedHouseNumber(q)
  switch (numberMatch(hit, number)) {
    case 'exact':
      return `house number ${hit.address?.house_number}`
    case 'other':
      return `house number ${hit.address?.house_number}, not ${number}`
    case 'street':
      return `street only, no house number ${number} in the data`
    default:
      return [hit.category, hit.type].filter(Boolean).join(' / ')
  }
}

/** The outline to draw for a hit: its polygon, or a street's line (never the building nearest to it). */
export function highlightFeature(hit: GeoHit): PolygonFeature | null {
  const polygon = polygonFeature(hit)
  if (polygon) return polygon
  const g = hit.geojson
  if (isStreetLevel(hit) && g && (g.type === 'LineString' || g.type === 'MultiLineString')) {
    return { type: 'Feature', properties: {}, geometry: g }
  }
  return null
}

type Ring = [number, number][]

export interface TileBuilding {
  geometry: { type: string; coordinates: unknown }
  properties: Record<string, unknown>
}

export interface BuildingHit {
  polygon: Ring[]
  height: number
  minHeight: number
}

/**
 * The tile building containing [lon, lat], else the nearest one within MAX_SNAP_M (address
 * points often sit on the facade or the street). OpenMapTiles merges neighbouring buildings
 * into one MultiPolygon, so polygons are tested one by one.
 */
export function buildingAt(features: TileBuilding[], lon: number, lat: number): BuildingHit | null {
  const origin = { lat, lon }
  const local = (ring: Ring) => ring.map(([x, y]) => project(y, x, origin))
  let best: { hit: BuildingHit; dist: number; area: number } | null = null
  for (const f of features) {
    const g = f.geometry
    const polygons =
      g.type === 'Polygon' ? [g.coordinates as Ring[]] : g.type === 'MultiPolygon' ? (g.coordinates as Ring[][]) : []
    for (const polygon of polygons) {
      const outer = local(polygon[0])
      const inside =
        pointInPolygon({ x: 0, z: 0 }, outer) && !polygon.slice(1).some((h) => pointInPolygon({ x: 0, z: 0 }, local(h)))
      const dist = inside ? 0 : distanceToRing(outer, { x: 0, z: 0 })
      const area = ringArea(outer)
      if (dist > MAX_SNAP_M) continue
      if (best && (dist > best.dist || (dist === best.dist && area >= best.area))) continue
      const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
      const height = num(f.properties.render_height, 9)
      best = { hit: { polygon, height, minHeight: num(f.properties.render_min_height, 0) }, dist, area }
    }
  }
  return best?.hit ?? null
}
