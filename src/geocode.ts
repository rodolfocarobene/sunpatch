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
  boundingbox?: [string, string, string, string] // south, north, west, east
  geojson?: { type: string; coordinates: unknown }
}

/** bounds is [west, south, east, north]. */
export function searchUrl(q: string, bounds?: [number, number, number, number], lang?: string): string {
  const p = new URLSearchParams({
    q,
    format: 'jsonv2',
    limit: '6',
    addressdetails: '0',
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

export function hitLabel(hit: GeoHit): string {
  return [hit.category, hit.type].filter(Boolean).join(' / ')
}
