import polygonClipping, { type MultiPolygon, type Polygon } from 'polygon-clipping'
import { fromPairs, polygonsOf, toPairs } from './edits'
import {
  buildingContains,
  pointInPolygon,
  ringArea,
  ringCentroid,
  snapBuilding,
  type Building,
  type Point,
} from './osm'

/*
 * One building is often mapped as several OSM polygons: an outline plus `building:part`s with their own
 * heights, a multipolygon relation with several outer rings, or the same footprint drawn twice. Picking
 * one of them must select all of them, otherwise the apartment is cut out of the wrong volume and the
 * floors above stay behind. The rule is deliberately narrow, because in Milan a block is a ring of
 * touching buildings and joining everything that touches would select the whole block:
 *
 *   - same OSM relation (the outer rings of one multipolygon);
 *   - same street + house number (both tagged);
 *   - `building:part`s lying in the outline (their outline is then only a footprint);
 *   - overlapping outlines (a polygon mostly inside another one is the same building mapped twice);
 *   - a `building:part` that lies in no outline joins the building it shares the longest wall with.
 *
 * Two different buildings that merely touch are not merged, and two different addresses never are.
 */

/** Gaps and offsets up to this size between two outlines still count as touching (OSM nodes are rarely shared exactly). */
export const TOUCH_TOLERANCE_M = 0.3
/** A stray part joins a building only when they share a wall at least this long; a corner or a short jog is not enough. */
export const MIN_SHARED_WALL_M = 4
/** A polygon with at least this share of its area inside another one belongs with it. */
const OVERLAP_SHARE = 0.5
/** Holes of the union smaller than this are gaps between outlines, not courtyards. */
const MIN_HOLE_AREA_M2 = 2
const COLLINEAR = Math.sin((5 * Math.PI) / 180)

/** Length of the stretches where two rings run side by side (within `tol`, nearly parallel). */
export function sharedWallLength(a: Point[], b: Point[], tol = TOUCH_TOLERANCE_M): number {
  let total = 0
  for (let i = 0; i < a.length; i++) {
    const p = a[i]
    const q = a[(i + 1) % a.length]
    const len = Math.hypot(q.x - p.x, q.z - p.z)
    if (len < 1e-9) continue
    const d = { x: (q.x - p.x) / len, z: (q.z - p.z) / len }
    // Stretches of the edge [0, len] covered by some edge of b, merged so overlaps count once.
    const covered: [number, number][] = []
    for (let j = 0; j < b.length; j++) {
      const r = b[j]
      const s = b[(j + 1) % b.length]
      const l2 = Math.hypot(s.x - r.x, s.z - r.z)
      if (l2 < 1e-9) continue
      if (Math.abs(d.x * (s.z - r.z) - d.z * (s.x - r.x)) / l2 > COLLINEAR) continue
      const off = (o: Point) => Math.abs(d.x * (o.z - p.z) - d.z * (o.x - p.x))
      if (off(r) > tol || off(s) > tol) continue
      const along = (o: Point) => (o.x - p.x) * d.x + (o.z - p.z) * d.z
      const lo = Math.max(0, Math.min(along(r), along(s)))
      const hi = Math.min(len, Math.max(along(r), along(s)))
      if (hi > lo) covered.push([lo, hi])
    }
    covered.sort((x, y) => x[0] - y[0])
    let end = 0
    for (const [lo, hi] of covered) {
      if (hi <= end) continue
      total += hi - Math.max(lo, end)
      end = hi
    }
  }
  return total
}

const polygonOf = (b: Pick<Building, 'outer' | 'holes'>): Polygon => [toPairs(b.outer), ...b.holes.map(toPairs)]

function areaOf(multi: MultiPolygon): number {
  let sum = 0
  for (const [outer, ...holes] of multi) {
    sum += ringArea(fromPairs(outer)) - holes.reduce((s, h) => s + ringArea(fromPairs(h)), 0)
  }
  return sum
}

const footprintArea = (b: Building) => ringArea(b.outer) - b.holes.reduce((s, h) => s + ringArea(h), 0)

/** Share of `a`'s area that lies inside `b`. */
function shareInside(a: Building, b: Building): number {
  const area = footprintArea(a)
  if (area < 1e-6) return 0
  return areaOf(polygonClipping.intersection(polygonOf(a), polygonOf(b))) / area
}

const relationOf = (b: Building) => (b.id.startsWith('relation/') ? b.id.split('#')[0] : undefined)
const isPart = (b: Building) => 'building:part' in b.tags

/** "street|number" when both are tagged, else undefined. */
export function addressKey(b: Building): string | undefined {
  const street = b.tags['addr:street']?.trim().toLowerCase()
  const number = b.tags['addr:housenumber']?.trim().toLowerCase()
  return street && number ? `${street}|${number}` : undefined
}

/** Both have an address and it differs: different buildings whatever the geometry says. */
function conflicting(a: Building, b: Building): boolean {
  const ka = addressKey(a)
  const kb = addressKey(b)
  return ka !== undefined && kb !== undefined && ka !== kb
}

function boundsOf(ring: Point[]) {
  let x0 = Infinity
  let x1 = -Infinity
  let z0 = Infinity
  let z1 = -Infinity
  for (const p of ring) {
    x0 = Math.min(x0, p.x)
    x1 = Math.max(x1, p.x)
    z0 = Math.min(z0, p.z)
    z1 = Math.max(z1, p.z)
  }
  return { x0, x1, z0, z1 }
}

/** Cheap pre-test: the bounding boxes meet (within the touch tolerance). */
function near(a: Building, b: Building): boolean {
  const p = boundsOf(a.outer)
  const q = boundsOf(b.outer)
  const t = TOUCH_TOLERANCE_M
  return p.x0 <= q.x1 + t && q.x0 <= p.x1 + t && p.z0 <= q.z1 + t && q.z0 <= p.z1 + t
}

/** The part lies in the outline: its centroid is inside, or at least half of it is. */
function partIn(part: Building, outline: Building): boolean {
  if (!near(part, outline)) return false
  return buildingContains(outline, ringCentroid(part.outer)) || shareInside(part, outline) >= OVERLAP_SHARE
}

/** Outlines (not parts) of `all` that hold at least one of `all`'s parts. */
function homes(part: Building, all: Building[]): Building[] {
  return all.filter((o) => !isPart(o) && o.id !== part.id && partIn(part, o))
}

/** The building a part belongs to: the smallest outline holding it, else the one it shares the longest wall with. */
export function homeOfPart(part: Building, all: Building[]): Building | undefined {
  const holding = homes(part, all).sort((a, b) => footprintArea(a) - footprintArea(b))
  if (holding.length) return holding[0]
  let best: Building | undefined
  let bestLength = MIN_SHARED_WALL_M
  for (const o of all) {
    if (o.id === part.id || !near(part, o) || conflicting(part, o)) continue
    const length = sharedWallLength(part.outer, o.outer)
    if (length >= bestLength) {
      best = o
      bestLength = length
    }
  }
  return best
}

/** Outlines related to `b` by relation, address or overlap (not by their parts). */
function samePlace(a: Building, b: Building): boolean {
  if (isPart(a) || isPart(b)) return false
  const rel = relationOf(a)
  if (rel && rel === relationOf(b)) return true
  if (conflicting(a, b)) return false
  const key = addressKey(a)
  if (key && key === addressKey(b)) return true
  return near(a, b) && Math.max(shareInside(a, b), shareInside(b, a)) >= OVERLAP_SHARE
}

/** Every polygon that belongs with `seed`, the seed first. A part stands for its home building. */
export function selectionGroup(all: Building[], seed: Building): Building[] {
  const root = isPart(seed) ? (homeOfPart(seed, all) ?? seed) : seed
  const group = new Map<string, Building>([[root.id, root]])
  const queue = [root]
  while (queue.length) {
    const a = queue.shift()!
    for (const b of all) {
      if (!group.has(b.id) && samePlace(a, b)) {
        group.set(b.id, b)
        queue.push(b)
      }
    }
  }
  for (const part of all.filter(isPart)) {
    const home = homeOfPart(part, all)
    if (home && group.has(home.id)) group.set(part.id, part)
  }
  group.set(seed.id, seed)
  return [seed, ...[...group.values()].filter((b) => b.id !== seed.id)]
}

/** Union of footprints as one polygon (the component under `anchor`); gaps between outlines are closed. */
export function unionFootprint(
  pieces: Building[],
  anchor: Point,
): { outer: Point[]; holes: Point[][]; used: Building[] } | undefined {
  const merged = polygonClipping.union(polygonOf(pieces[0]), ...pieces.slice(1).map(polygonOf))
  const polygons = polygonsOf(merged)
  const chosen =
    polygons.find((p) => pointInPolygon(anchor, p.outer)) ??
    polygons.sort((a, b) => ringArea(b.outer) - ringArea(a.outer))[0]
  if (!chosen) return undefined
  const holes = chosen.holes.filter((h) => ringArea(h) >= MIN_HOLE_AREA_M2)
  const whole: Polygon = [toPairs(chosen.outer)]
  // Pieces of other components (a relation with far-apart outer rings) are left out.
  const used = pieces.filter((p) => areaOf(polygonClipping.intersection(whole, polygonOf(p))) > 0 || p === pieces[0])
  return { outer: chosen.outer, holes, used }
}

/**
 * The building the user picked, with everything that belongs to it merged in (see the rules at the top of
 * this file). A lone polygon is returned as it is, so plans saved on it keep working. Otherwise the
 * result has the id of the largest outline, whichever polygon was clicked.
 */
export function mergeSelection(all: Building[], seed: Building): Building {
  const group = selectionGroup(all, seed)
  if (group.length === 1) return seed
  const anchor = ringCentroid(seed.outer)
  const union = unionFootprint(group, anchor)
  if (!union) return seed
  const used = union.used
  // An outline whose parts are in the group is only their footprint: it is not drawn itself.
  const parts = used.filter(isPart)
  const members = used.filter((b) => isPart(b) || !parts.some((p) => partIn(p, b)))
  if (used.length === 1) return seed
  const primary = used.filter((b) => !isPart(b)).sort((a, b) => footprintArea(b) - footprintArea(a))[0] ?? used[0]
  const tallest = [...members].sort((a, b) => b.height - a.height)[0]
  const minHeight = Math.min(...members.map((m) => m.minHeight))
  const sameStart = tallest.minHeight === minHeight
  return {
    id: primary.id,
    outer: union.outer,
    holes: union.holes,
    minHeight,
    height: tallest.height,
    heightSource: tallest.heightSource,
    ...(tallest.levels !== undefined && sameStart ? { levels: tallest.levels } : {}),
    tags: primary.tags,
    members,
    sources: used.map((b) => b.id),
  }
}

/** The building at p (or the nearest within snapping distance), with its parts and sibling polygons merged. */
export function selectBuilding(all: Building[], p: Point): Building | undefined {
  const seed = snapBuilding(all, p)
  return seed && mergeSelection(all, seed)
}
