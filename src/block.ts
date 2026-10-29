import polygonClipping, { type MultiPolygon, type Polygon } from 'polygon-clipping'
import { fromPairs, polygonsOf, toPairs } from './edits'
import {
  buildingContains,
  distanceToRing,
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
 * floors above stay behind. Neighbouring volumes of different height are often separate ways that merely
 * touch, so the selection is a flood fill over a graph of polygons. Two polygons are linked when:
 *
 *   - they are the same OSM relation (the outer rings of one multipolygon);
 *   - they have the same street + house number (both tagged);
 *   - one is a `building:part` lying in the other's outline;
 *   - they overlap (a polygon mostly inside another one is the same building mapped twice);
 *   - they touch: a shared wall of at least MIN_TOUCH_M (within TOUCH_TOLERANCE_M), or any real overlap.
 *     A shared corner does not count.
 *
 * In Milan that can be a whole perimeter block; the user trims it with `togglePart` (shift-click). The fill
 * stops at MAX_SELECTION_POLYGONS polygons or MAX_SELECTION_RADIUS_M from the click and says so (`capped`).
 */

/** Gaps and offsets up to this size between two outlines still count as touching (OSM nodes are rarely shared exactly). */
export const TOUCH_TOLERANCE_M = 0.3
/** Two polygons touch when they share a wall at least this long (a corner or a point contact does not count). */
export const MIN_TOUCH_M = 1
/** Overlap below this area is a sliver, not the same building. */
const MIN_OVERLAP_M2 = 1
/** The fill stops at this many polygons ... */
export const MAX_SELECTION_POLYGONS = 60
/** ... or at polygons further than this from the click. */
export const MAX_SELECTION_RADIUS_M = 250
/** A polygon with at least this share of its area inside another one belongs with it. */
const OVERLAP_SHARE = 0.5
/** Holes of the union smaller than this are gaps between outlines, not courtyards. */
const MIN_HOLE_AREA_M2 = 2
const COLLINEAR = Math.sin((5 * Math.PI) / 180)

/** Length of the stretches where two rings run side by side (within `tol`, nearly parallel). */
export function sharedWallLength(
  a: Point[],
  b: Point[],
  tol = TOUCH_TOLERANCE_M,
  /** Only walls of `a` for which this holds are measured. */
  edge: (p: Point, q: Point) => boolean = () => true,
): number {
  let total = 0
  for (let i = 0; i < a.length; i++) {
    const p = a[i]
    const q = a[(i + 1) % a.length]
    if (!edge(p, q)) continue
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

/** The two polygons share a wall of at least MIN_TOUCH_M, or overlap by more than a sliver. */
export function touching(a: Building, b: Building): boolean {
  if (!near(a, b)) return false
  if (sharedWallLength(a.outer, b.outer, TOUCH_TOLERANCE_M) >= MIN_TOUCH_M) return true
  return areaOf(polygonClipping.intersection(polygonOf(a), polygonOf(b))) >= MIN_OVERLAP_M2
}

/** Edge of the selection graph: see the rules at the top of this file. */
export function linked(a: Building, b: Building): boolean {
  if (isPart(a) !== isPart(b) && partIn(isPart(a) ? a : b, isPart(a) ? b : a)) return true
  return samePlace(a, b) || touching(a, b)
}

/** Distance from the click to the polygon, 0 when inside. */
const distanceFrom = (b: Building, p: Point) => (buildingContains(b, p) ? 0 : distanceToRing(b.outer, p))

/** The polygons connected to `seed` (the seed first), breadth first from the click, and whether a cap stopped the fill. */
export function floodSelection(all: Building[], seed: Building, click?: Point): { group: Building[]; capped: boolean } {
  const from = click ?? ringCentroid(seed.outer)
  const group = new Map<string, Building>([[seed.id, seed]])
  const queue = [seed]
  let capped = false
  while (queue.length) {
    const a = queue.shift()!
    const next = all
      .filter((b) => !group.has(b.id) && linked(a, b))
      .map((b) => ({ b, d: distanceFrom(b, from) }))
      .sort((x, y) => x.d - y.d)
    for (const { b, d } of next) {
      if (group.size >= MAX_SELECTION_POLYGONS || d > MAX_SELECTION_RADIUS_M) {
        capped = true
        continue
      }
      group.set(b.id, b)
      queue.push(b)
    }
  }
  return { group: [...group.values()], capped }
}

/** Every polygon that belongs with `seed`, the seed first. */
export const selectionGroup = (all: Building[], seed: Building, click?: Point): Building[] =>
  floodSelection(all, seed, click).group

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

export interface SelectionOptions {
  /** Where the user clicked: the distance cap is measured from here (default: the seed's centre). */
  click?: Point
  /** Use exactly these polygons (plus the seed) instead of flooding: a trimmed or restored selection. */
  ids?: string[]
  /** The id (plan key) the result gets, instead of the largest outline's. */
  id?: string
}

/**
 * The building the user picked, with everything connected to it merged in (see the rules at the top of
 * this file). A lone polygon is returned as it is, so plans saved on it keep working. Otherwise the
 * result has the id of the largest outline, whichever polygon was clicked, and `anchor` is the clicked one.
 */
export function mergeSelection(all: Building[], seed: Building, options: SelectionOptions = {}): Building {
  const flood = options.ids ? undefined : floodSelection(all, seed, options.click)
  const wanted = options.ids && new Set(options.ids)
  const group = flood ? flood.group : [seed, ...all.filter((b) => b.id !== seed.id && wanted!.has(b.id))]
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
    id: options.id ?? primary.id,
    outer: union.outer,
    holes: union.holes,
    minHeight,
    height: tallest.height,
    heightSource: tallest.heightSource,
    ...(tallest.levels !== undefined && sameStart ? { levels: tallest.levels } : {}),
    tags: primary.tags,
    members,
    sources: used.map((b) => b.id),
    anchor: seed.id,
    ...(flood?.capped ? { capped: true } : {}),
  }
}

/** The building at p (or the nearest within snapping distance), with everything connected to it merged in. */
export function selectBuilding(all: Building[], p: Point, options: Omit<SelectionOptions, 'click'> = {}): Building | undefined {
  const seed = snapBuilding(all, p)
  return seed && mergeSelection(all, seed, { ...options, click: p })
}

/** The polygons of `selected` as ids: what a plan stores to restore the same parts. */
export const selectionIds = (selected: Building): string[] => selected.sources ?? [selected.id]

/** Rebuilds a stored selection: the same polygons as before, with the same plan key. Falls back to flooding. */
export function restoreSelection(all: Building[], p: Point, saved: { id: string; ids: string[] }): Building | undefined {
  const byId = new Map(all.map((b) => [b.id, b]))
  const seed = snapBuilding(all, p)
  if (!seed || !saved.ids.includes(seed.id) || !saved.ids.every((id) => byId.has(id))) return selectBuilding(all, p)
  return mergeSelection(all, seed, { ids: saved.ids, id: saved.id })
}

/** Polygons connected to `anchor` through `ids` only. */
function connectedTo(all: Building[], ids: Set<string>, anchor: Building): Set<string> {
  const pool = all.filter((b) => ids.has(b.id) && b.id !== anchor.id)
  const found = new Set([anchor.id])
  const queue = [anchor]
  while (queue.length) {
    const a = queue.shift()!
    for (const b of pool) {
      if (!found.has(b.id) && linked(a, b)) {
        found.add(b.id)
        queue.push(b)
      }
    }
  }
  return found
}

/**
 * Shift-click: removes the polygon from the selection, or adds it when it touches the selection. The
 * polygon first clicked (`anchor`) always stays, and a removal also drops whatever it was the only link to.
 * The result keeps the plan key (`id`) of `current`. `hint` says why nothing changed.
 */
export function togglePart(all: Building[], current: Building, polygonId: string): { selected: Building } | { hint: string } {
  const target = all.find((b) => b.id === polygonId)
  const anchor = all.find((b) => b.id === (current.anchor ?? current.id))
  if (!target || !anchor) return { hint: 'That is not a building polygon.' }
  const ids = new Set(selectionIds(current))
  if (ids.has(polygonId)) {
    if (polygonId === anchor.id) return { hint: 'The part you clicked first stays selected.' }
    ids.delete(polygonId)
    // A part leaves with the outline that was only its footprint.
    if (isPart(target)) for (const o of all) if (ids.has(o.id) && !isPart(o) && partIn(target, o)) ids.delete(o.id)
  } else {
    if (!all.some((b) => ids.has(b.id) && linked(target, b))) return { hint: 'That building does not touch your selection.' }
    ids.add(polygonId)
    if (!isPart(target)) for (const p of all) if (isPart(p) && partIn(p, target)) ids.add(p.id)
  }
  const kept = connectedTo(all, ids, anchor)
  return { selected: mergeSelection(all, anchor, { ids: [...kept], id: current.id }) }
}
