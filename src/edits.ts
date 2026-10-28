import polygonClipping, { type MultiPolygon, type Pair, type Polygon } from 'polygon-clipping'
import { ringArea } from './osm'
import type { Point } from './osm'
import type { BuildingEdit } from './plan'

const EPS = 1e-6
const MIN_SLIVER_AREA = 0.05

export interface Piece {
  outer: Point[]
  holes: Point[][]
  bottom: number
  top: number
}

/** A volume removed from the building: its footprint region between two heights. */
export interface Cut {
  region: MultiPolygon
  bottom: number
  top: number
}

export const toPairs = (ring: Point[]): Pair[] => ring.map((p) => [p.x, p.z])

export function fromPairs(ring: Pair[]): Point[] {
  const points = ring.map(([x, z]) => ({ x, z }))
  const first = points[0]
  const last = points[points.length - 1]
  if (last.x === first.x && last.z === first.z) points.pop()
  return points
}

/** Polygons with holes from a clipping result, dropping slivers. */
export function polygonsOf(multi: MultiPolygon): { outer: Point[]; holes: Point[][] }[] {
  const result: { outer: Point[]; holes: Point[][] }[] = []
  for (const [outer, ...holes] of multi) {
    const polygon = { outer: fromPairs(outer), holes: holes.map(fromPairs) }
    const area = ringArea(polygon.outer) - polygon.holes.reduce((sum, h) => sum + ringArea(h), 0)
    if (area >= MIN_SLIVER_AREA) result.push(polygon)
  }
  return result
}

export const addsOf = (edits: BuildingEdit[] | undefined) =>
  (edits ?? []).filter((e) => e.kind === 'add' && e.outline.length >= 3 && e.top - e.bottom > EPS)

export function cutsOf(edits: BuildingEdit[] | undefined): Cut[] {
  return (edits ?? [])
    .filter((e) => e.kind === 'cut' && e.outline.length >= 3 && e.top - e.bottom > EPS)
    .map((e) => ({ region: [[toPairs(e.outline)]], bottom: e.bottom, top: e.top }))
}

/** The cuts that reach into the height range [y0, y1] lose the part inside `keep` (the apartment outline). */
export function sparing(cuts: Cut[], keep: Polygon, y0: number, y1: number): Cut[] {
  return cuts.map((c) =>
    c.bottom < y1 - EPS && c.top > y0 + EPS ? { ...c, region: polygonClipping.difference(c.region, keep) } : c,
  )
}

/**
 * A prism with this footprint from `bottom` to `top`, minus the cuts: the height range is split at every
 * cut bottom and top, and each sub-range keeps the footprint minus the cuts active over all of it.
 */
export function carve(outer: Point[], holes: Point[][], bottom: number, top: number, cuts: Cut[]): Piece[] {
  const levels = new Set([bottom, top])
  for (const c of cuts) for (const y of [c.bottom, c.top]) if (y > bottom + EPS && y < top - EPS) levels.add(y)
  const ys = [...levels].sort((a, b) => a - b)
  const footprint: Polygon = [toPairs(outer), ...holes.map(toPairs)]
  const pieces: Piece[] = []
  for (let i = 0; i + 1 < ys.length; i++) {
    const [y0, y1] = [ys[i], ys[i + 1]]
    if (y1 - y0 < EPS) continue
    const active = cuts.filter((c) => c.bottom <= y0 + EPS && c.top >= y1 - EPS && c.region.length > 0)
    if (!active.length) {
      pieces.push({ outer, holes, bottom: y0, top: y1 })
      continue
    }
    const removed = polygonClipping.union(active[0].region, ...active.slice(1).map((c) => c.region))
    for (const p of polygonsOf(polygonClipping.difference(footprint, removed))) {
      pieces.push({ ...p, bottom: y0, top: y1 })
    }
  }
  return pieces
}
