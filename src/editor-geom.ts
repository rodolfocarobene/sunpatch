import { FACADE_THICKNESS, SLAB_THICKNESS, ringOf, type Plan, type Window } from './plan'
import { buildingContains, pickBuilding, type Building, type Point } from './osm'

export type Segment = [Point, Point]

export interface SegmentHit {
  point: Point
  /** Position along the segment, 0..1 (clamped). */
  t: number
  dist: number
}

/** Closest point of segment a-b to p. */
export function projectOnSegment(p: Point, a: Point, b: Point): SegmentHit {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const len2 = dx * dx + dz * dz
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2)) : 0
  const point = { x: a.x + t * dx, z: a.z + t * dz }
  return { point, t, dist: Math.hypot(point.x - p.x, point.z - p.z) }
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  return projectOnSegment(p, a, b).dist
}

export function ringSegments(ring: Point[]): Segment[] {
  return ring.map((a, i) => [a, ring[(i + 1) % ring.length]] as Segment)
}

export interface Snap {
  point: Point
  kind: 'vertex' | 'edge' | 'none'
}

/** Snaps p to the nearest vertex within `tol`, else to the nearest point on a segment within `tol`. */
export function snapPoint(p: Point, vertices: Point[], segments: Segment[], tol: number): Snap {
  let best: Point | undefined
  let bestD = tol
  for (const v of vertices) {
    const d = Math.hypot(v.x - p.x, v.z - p.z)
    if (d <= bestD) {
      bestD = d
      best = v
    }
  }
  if (best) return { point: { ...best }, kind: 'vertex' }
  for (const [a, b] of segments) {
    const hit = projectOnSegment(p, a, b)
    if (hit.dist <= bestD) {
      bestD = hit.dist
      best = hit.point
    }
  }
  return best ? { point: best, kind: 'edge' } : { point: { ...p }, kind: 'none' }
}

/** Nearest edge over several rings (ring index as in Window.ring) within `tol`. */
export function nearestEdge(
  rings: Point[][],
  p: Point,
  tol: number,
): { ring: number; edge: number; t: number; dist: number } | undefined {
  let best: { ring: number; edge: number; t: number; dist: number } | undefined
  rings.forEach((ring, r) => {
    ringSegments(ring).forEach(([a, b], edge) => {
      const hit = projectOnSegment(p, a, b)
      if (hit.dist <= tol && (!best || hit.dist < best.dist)) best = { ring: r, edge, t: hit.t, dist: hit.dist }
    })
  })
  return best
}

/** A window keeps this far from each end of its edge: the neighbouring facade wall overlaps that much of it. */
export const WINDOW_CLEARANCE = FACADE_THICKNESS
/** Minimum gap between two windows on one edge. */
export const WINDOW_GAP = 0.1
/** Room kept above a window and below it, so it never touches the floor or the ceiling slab. */
export const WINDOW_VERTICAL_MARGIN = 0.05
const MIN_WINDOW_HEIGHT = 0.2

interface Placed {
  t: number
  width: number
}

/**
 * Window centre `t` closest to the wanted one such that a window of `width` stays inside an edge of
 * `edgeLength`, clear of both ends by WINDOW_CLEARANCE and of the `others` on the same edge by WINDOW_GAP.
 * Null when no such place exists.
 */
export function placeWindowT(t: number, width: number, edgeLength: number, others: Placed[] = []): number | null {
  // Free stretches of the edge, in metres from its start, as [from, to] for the window's edges.
  let free: [number, number][] = [[WINDOW_CLEARANCE, edgeLength - WINDOW_CLEARANCE]]
  const taken = others
    .map((o) => [o.t * edgeLength - o.width / 2 - WINDOW_GAP, o.t * edgeLength + o.width / 2 + WINDOW_GAP] as const)
    .sort((x, y) => x[0] - y[0])
  for (const [from, to] of taken) {
    free = free.flatMap(([f, e]): [number, number][] =>
      to <= f || from >= e ? [[f, e]] : [[f, Math.min(e, from)], [Math.max(f, to), e]],
    )
  }
  const want = t * edgeLength
  let best: number | null = null
  for (const [f, e] of free) {
    if (e - f < width - 1e-9) continue
    const centre = Math.max(f + width / 2, Math.min(e - width / 2, want))
    if (best === null || Math.abs(centre - want) < Math.abs(best - want)) best = centre
  }
  return best === null ? null : best / edgeLength
}

/** `placeWindowT` for a window alone on its edge. */
export function clampWindowT(t: number, width: number, edgeLength: number): number | null {
  return placeWindowT(t, width, edgeLength)
}

/** Sill and height that fit in a wall of `wallHeight` (floor height minus the ceiling slab). */
export function clampWindowVertical(sill: number, height: number, wallHeight: number): { sill: number; height: number } {
  const top = wallHeight - WINDOW_VERTICAL_MARGIN
  const s = Math.max(WINDOW_VERTICAL_MARGIN, Math.min(sill, top - MIN_WINDOW_HEIGHT))
  return { sill: s, height: Math.max(MIN_WINDOW_HEIGHT, Math.min(height, top - s)) }
}

/**
 * Brings every window of the plan to a valid place in the same way the editor does when it places one:
 * clear of the edge ends, of each other and of the ceiling. Mutates and returns the plan.
 */
export function normalizeWindows(plan: Plan): Plan {
  const wallHeight = plan.floorHeight - SLAB_THICKNESS
  const placed: Window[] = []
  for (const w of plan.windows) {
    const ring = ringOf(plan, w.ring)
    const a = ring[w.edge]
    const b = ring[(w.edge + 1) % ring.length]
    if (a && b) {
      const length = Math.hypot(b.x - a.x, b.z - a.z)
      const t = placeWindowT(w.t, w.width, length, placed.filter((o) => o.ring === w.ring && o.edge === w.edge))
      if (t !== null) w.t = t
    }
    Object.assign(w, clampWindowVertical(w.sill, w.height, wallHeight))
    placed.push(w)
  }
  return plan
}

/** Walls shorter than this are not created (metres); also how close to the chain's start counts as closing it. */
export const MIN_WALL_LENGTH = 0.05

export interface ChainStep {
  /** The chain's points after the click: its start, then the end of every wall so far. Empty once closed. */
  chain: Point[]
  /** The wall this click adds. */
  wall?: Segment
  closed: boolean
  tooShort?: boolean
}

/**
 * One click of the Wall tool. The first click starts the chain, each further click adds a wall from
 * the previous end point, and a click back on the start (after at least two walls) closes and ends it.
 */
export function chainStep(chain: Point[], p: Point): ChainStep {
  if (!chain.length) return { chain: [p], closed: false }
  const last = chain[chain.length - 1]
  if (Math.hypot(p.x - last.x, p.z - last.z) < MIN_WALL_LENGTH) return { chain, closed: false, tooShort: true }
  const closes = chain.length >= 3 && Math.hypot(p.x - chain[0].x, p.z - chain[0].z) < MIN_WALL_LENGTH
  const end = closes ? chain[0] : p
  return { chain: closes ? [] : [...chain, p], wall: [last, end], closed: closes }
}

/** Projects p onto the line through `origin` along the closest of the given directions (unit vectors, both senses). */
export function constrainToDirections(origin: Point, p: Point, directions: Point[]): Point {
  const vx = p.x - origin.x
  const vz = p.z - origin.z
  let best = p
  let bestD = Infinity
  for (const d of directions) {
    const s = vx * d.x + vz * d.z
    const q = { x: origin.x + s * d.x, z: origin.z + s * d.z }
    const dist = Math.hypot(q.x - p.x, q.z - p.z)
    if (dist < bestD) {
      bestD = dist
      best = q
    }
  }
  return best
}

/** Unit direction of a-b, or undefined for a degenerate segment. */
export function unitDirection(a: Point, b: Point): Point | undefined {
  const len = Math.hypot(b.x - a.x, b.z - a.z)
  return len ? { x: (b.x - a.x) / len, z: (b.z - a.z) / len } : undefined
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x)
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = cross(a, b, c)
  const d2 = cross(a, b, d)
  const d3 = cross(c, d, a)
  const d4 = cross(c, d, b)
  return d1 * d2 < 0 && d3 * d4 < 0
}

/** True when two non-adjacent edges properly cross, or two vertices coincide. Needs >= 3 points. */
export function selfIntersects(ring: Point[]): boolean {
  const n = ring.length
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.hypot(ring[i].x - ring[j].x, ring[i].z - ring[j].z) < 1e-9) return true
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue
      if (segmentsCross(ring[i], ring[(i + 1) % n], ring[j], ring[(j + 1) % n])) return true
    }
  }
  return false
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isPoint = (v: unknown): v is Point => !!v && isNum((v as Point).x) && isNum((v as Point).z)
const isRing = (v: unknown): v is Point[] => Array.isArray(v) && v.length >= 3 && v.every(isPoint)

/** Checks a parsed JSON value against the Plan contract; returns the plan or an error message. */
export function validatePlan(value: unknown): { plan: Plan } | { error: string } {
  const p = value as Plan | null
  if (!p || typeof p !== 'object') return { error: 'Not a plan object' }
  if (p.version !== 1) return { error: 'Unsupported plan version' }
  if (typeof p.buildingId !== 'string' || !p.buildingId) return { error: 'Missing buildingId' }
  if (!p.origin || !isNum(p.origin.lat) || !isNum(p.origin.lon)) return { error: 'Invalid origin' }
  if (!Number.isInteger(p.floor) || p.floor < 0) return { error: 'Invalid floor' }
  if (!isNum(p.floorHeight) || p.floorHeight <= 0) return { error: 'Invalid floorHeight' }
  if (!p.outline || !isRing(p.outline.outer)) return { error: 'Invalid outline' }
  if (!Array.isArray(p.outline.holes) || !p.outline.holes.every(isRing)) return { error: 'Invalid outline holes' }
  if (!Array.isArray(p.walls)) return { error: 'Invalid walls' }
  for (const w of p.walls) {
    if (!w || !isPoint(w.a) || !isPoint(w.b) || !isNum(w.thickness) || w.thickness <= 0) return { error: 'Invalid wall' }
  }
  if (!Array.isArray(p.windows)) return { error: 'Invalid windows' }
  const rings = [p.outline.outer, ...p.outline.holes]
  for (const w of p.windows) {
    if (!w || !Number.isInteger(w.ring) || w.ring < 0 || w.ring >= rings.length) return { error: 'Invalid window ring' }
    if (!Number.isInteger(w.edge) || w.edge < 0 || w.edge >= rings[w.ring].length) return { error: 'Invalid window edge' }
    if (!isNum(w.t) || w.t < 0 || w.t > 1) return { error: 'Invalid window position' }
    if (!isNum(w.width) || w.width <= 0 || !isNum(w.sill) || w.sill < 0 || !isNum(w.height) || w.height <= 0) {
      return { error: 'Invalid window size' }
    }
  }
  if (p.viewpoint !== undefined) {
    const v = p.viewpoint
    if (!v || !isNum(v.x) || !isNum(v.z) || !isNum(v.yaw)) return { error: 'Invalid viewpoint' }
  }
  if (p.edits !== undefined) {
    if (!Array.isArray(p.edits)) return { error: 'Invalid edits' }
    for (const e of p.edits) {
      if (!e || (e.kind !== 'add' && e.kind !== 'cut')) return { error: 'Invalid edit kind' }
      if (!isRing(e.outline)) return { error: 'Invalid edit outline' }
      if (!isNum(e.bottom) || !isNum(e.top) || e.bottom >= e.top) return { error: 'Invalid edit heights' }
    }
  }
  const panels = p.panels ?? []
  if (!Array.isArray(panels)) return { error: 'Invalid panels' }
  for (const q of panels) {
    if (!q || typeof q.id !== 'string' || !q.id || !isPoint(q)) return { error: 'Invalid panel' }
    if (!isNum(q.elevation) || !isNum(q.azimuth)) return { error: 'Invalid panel position' }
    if (!isNum(q.width) || q.width <= 0 || !isNum(q.height) || q.height <= 0) return { error: 'Invalid panel size' }
    if (!isNum(q.tilt) || q.tilt < 0 || q.tilt > 90) return { error: 'Invalid panel tilt' }
    if (q.count !== undefined && (!Number.isInteger(q.count) || q.count < 1)) return { error: 'Invalid panel count' }
  }
  return { plan: { ...p, panels } }
}

export interface FitRect {
  /** Pixels of the SVG covered by the panels on each side (the map area is what is left). */
  left: number
  right: number
  top: number
  bottom: number
}

/** View centre and scale (pixels per metre) that frame `points` inside the free area of a w x h canvas. */
export function fitBounds(
  points: Point[],
  w: number,
  h: number,
  free: FitRect,
  limits: { min: number; max: number },
  fill = 0.85,
): { cx: number; cz: number; scale: number } {
  const xs = points.map((p) => p.x)
  const zs = points.map((p) => p.z)
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)]
  const areaW = Math.max(w - free.left - free.right, 1)
  const areaH = Math.max(h - free.top - free.bottom, 1)
  const raw = Math.min(areaW / Math.max(x1 - x0, 1), areaH / Math.max(z1 - z0, 1)) * fill
  const scale = Math.max(limits.min, Math.min(limits.max, raw))
  // The bounds' centre lands on the centre of the free area, not of the canvas.
  const dx = free.left + areaW / 2 - w / 2
  const dy = free.top + areaH / 2 - h / 2
  return { cx: (x0 + x1) / 2 - dx / scale, cz: (z0 + z1) / 2 - dy / scale, scale }
}

/** The neighbouring building under `p` (plan metres), or none when `p` is on the selected building or on empty ground. */
export function neighborAt(selected: Pick<Building, 'outer' | 'holes'>, neighbors: Building[], p: Point): Building | undefined {
  if (buildingContains(selected as Building, p)) return undefined
  return pickBuilding(neighbors, p)
}
