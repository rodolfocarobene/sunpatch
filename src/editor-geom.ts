import type { Plan } from './plan'
import type { Point } from './osm'

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

/**
 * Window centre `t` clamped so a window of `width` fits inside an edge of `edgeLength`;
 * null when the edge is too short.
 */
export function clampWindowT(t: number, width: number, edgeLength: number): number | null {
  if (width > edgeLength) return null
  const half = width / 2 / edgeLength
  return Math.max(half, Math.min(1 - half, t))
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
  return { plan: p }
}
