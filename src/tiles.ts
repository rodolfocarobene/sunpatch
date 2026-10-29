import { closedUnion, MIN_TOUCH_M, sharedWallLength, touching } from './block'
import { polygonsOf, toPairs } from './edits'
import type { TileBuilding } from './geocode'
import { distanceToRing, project, type Building, type Origin, type Point } from './osm'

type Ring = [number, number][]

const DEFAULT_HEIGHT = 9

/** Pieces are only joined (and the rest of the work skipped) within this margin beyond the radius. */
const JOIN_MARGIN_M = 60
const AXIS_TOLERANCE_M = 0.1

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)

/**
 * Buildings from OpenMapTiles `building` features, as a quick preview before Overpass answers.
 * Ids are numbered over the de-duplicated polygons, so they do not depend on origin or radius.
 * The same polygon shows up once per tile that contains it. Tile clipping also cuts one building into
 * pieces at tile borders: `joinPieces` puts those back together.
 */
export function tileBuildings(features: TileBuilding[], origin: Origin, radiusM: number): Building[] {
  const pieces: { building: Building; featureId?: string | number }[] = []
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
      if (distanceToRing(outer, { x: 0, z: 0 }) > radiusM + JOIN_MARGIN_M) continue
      const height = num(f.properties.render_height, DEFAULT_HEIGHT)
      // No render_height means the tiles have no height for it either: the 9 m is a guess, as in OSM.
      const heightSource = typeof f.properties.render_height === 'number' ? 'tile' : 'default'
      let minHeight = num(f.properties.render_min_height, 0)
      if (minHeight >= height) minHeight = 0
      pieces.push({
        featureId: f.id,
        building: { id, outer, holes: polygon.slice(1).map(toLocal), minHeight, height, heightSource, tags: {} },
      })
    }
  }
  return joinPieces(pieces).filter((b) => distanceToRing(b.outer, { x: 0, z: 0 }) <= radiusM)
}

const axisAligned = (p: Point, q: Point) => Math.abs(p.x - q.x) < AXIS_TOLERANCE_M || Math.abs(p.z - q.z) < AXIS_TOLERANCE_M

/**
 * Two tile polygons are halves of one building when they have the same heights, touch or overlap, and
 * share a feature id. Without ids, a wall running along a line of constant longitude or latitude (where
 * tiles are cut) stands in for it, or an overlap (the buffer tiles carry beyond their border).
 */
function samePiece(a: { building: Building; featureId?: string | number }, b: typeof a): boolean {
  const p = a.building
  const q = b.building
  if (p.height !== q.height || p.minHeight !== q.minHeight) return false
  if (a.featureId !== undefined && b.featureId !== undefined && a.featureId !== b.featureId) return false
  if (!touching(p, q)) return false
  if (a.featureId !== undefined && a.featureId === b.featureId) return true
  return sharedWallLength(p.outer, q.outer, undefined, axisAligned) >= MIN_TOUCH_M || !hasWall(p, q)
}

/** The polygons share a wall (so they only touch), as opposed to overlapping. */
const hasWall = (p: Building, q: Building) => sharedWallLength(p.outer, q.outer) >= MIN_TOUCH_M

/** Merges the pieces of one building cut at tile borders into one footprint; ids are those of the first piece. */
export function joinPieces(pieces: { building: Building; featureId?: string | number }[]): Building[] {
  const root = pieces.map((_, i) => i)
  const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i])))
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      if (find(i) !== find(j) && samePiece(pieces[i], pieces[j])) root[find(j)] = find(i)
    }
  }
  const groups = new Map<number, Building[]>()
  pieces.forEach((p, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), p.building]))
  return [...groups.values()].flatMap((group) => {
    if (group.length === 1) return group
    const regions = polygonsOf(closedUnion(group.map((b) => [toPairs(b.outer), ...b.holes.map(toPairs)])))
    // A seam that does not close (rounding at the border) leaves the pieces as they are.
    if (regions.length !== 1) return group
    return [{ ...group[0], outer: regions[0].outer, holes: regions[0].holes }]
  })
}
