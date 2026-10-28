import type { TileBuilding } from './geocode'
import { distanceToRing, project, type Building, type Origin, type Point } from './osm'

type Ring = [number, number][]

const DEFAULT_HEIGHT = 9

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)

/**
 * Buildings from OpenMapTiles `building` features, as a quick preview before Overpass answers.
 * Ids are numbered over the de-duplicated polygons, so they do not depend on origin or radius.
 * The same polygon shows up once per tile that contains it; tile clipping can still cut one
 * building into several pieces.
 */
export function tileBuildings(features: TileBuilding[], origin: Origin, radiusM: number): Building[] {
  const buildings: Building[] = []
  const seen = new Set<string>()
  let n = 0
  const toLocal = (ring: Ring): Point[] => ring.slice(0, -1).map(([lon, lat]) => project(lat, lon, origin))
  for (const f of features) {
    if (f.properties.hide_3d === true) continue
    const g = f.geometry
    const polygons =
      g.type === 'Polygon' ? [g.coordinates as Ring[]] : g.type === 'MultiPolygon' ? (g.coordinates as Ring[][]) : []
    for (const polygon of polygons) {
      if (polygon[0]?.length < 4) continue
      const key = JSON.stringify(polygon)
      if (seen.has(key)) continue
      seen.add(key)
      const id = `tile/${n++}`
      const outer = toLocal(polygon[0])
      if (distanceToRing(outer, { x: 0, z: 0 }) > radiusM) continue
      const height = num(f.properties.render_height, DEFAULT_HEIGHT)
      let minHeight = num(f.properties.render_min_height, 0)
      if (minHeight >= height) minHeight = 0
      buildings.push({
        id, outer, holes: polygon.slice(1).map(toLocal), minHeight, height, heightSource: 'tile', tags: {},
      })
    }
  }
  return buildings
}
