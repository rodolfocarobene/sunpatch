import { pointInPolygon, ringCentroid, type Point } from './osm'
import { projectOnSegment } from './editor-geom'
import { FACADE_THICKNESS, ringOf, type Plan } from './plan'

export const WALK_RADIUS = 0.25
const START_CLEARANCE = 0.5
const GRID_STEP = 0.25
const RESOLVE_ITERATIONS = 4

/** A wall as seen from above: the centre line (or outer face, for facades) plus how far the solid reaches from it. */
interface Wall {
  a: Point
  b: Point
  reach: number
}

/**
 * Facade walls stand on the inner side of the outline, so the outline segment is their outer face and
 * the wall reaches FACADE_THICKNESS from it into the room; interior walls reach half their thickness.
 */
export function wallsOf(plan: Plan): Wall[] {
  const walls: Wall[] = []
  for (let r = 0; r <= plan.outline.holes.length; r++) {
    const ring = ringOf(plan, r)
    ring.forEach((a, i) => walls.push({ a, b: ring[(i + 1) % ring.length], reach: FACADE_THICKNESS }))
  }
  for (const w of plan.walls) walls.push({ a: w.a, b: w.b, reach: w.thickness / 2 })
  return walls
}

export function insideOutline(plan: Plan, p: Point): boolean {
  return pointInPolygon(p, plan.outline.outer) && !plan.outline.holes.some((h) => pointInPolygon(p, h))
}

/** Inside the outline and at least `clearance` metres from every wall surface. */
export function isWalkable(plan: Plan, p: Point, clearance = WALK_RADIUS): boolean {
  return insideOutline(plan, p) && wallsOf(plan).every((w) => projectOnSegment(p, w.a, w.b).dist >= clearance + w.reach - 1e-6)
}

/** Pushes a circle of `radius` out of every wall; undefined when it cannot be placed inside the apartment. */
export function resolvePosition(plan: Plan, p: Point, radius = WALK_RADIUS): Point | undefined {
  const walls = wallsOf(plan)
  let { x, z } = p
  for (let i = 0; i < RESOLVE_ITERATIONS; i++) {
    let moved = false
    for (const w of walls) {
      const hit = projectOnSegment({ x, z }, w.a, w.b)
      const min = radius + w.reach
      if (hit.dist >= min) continue
      let nx = x - hit.point.x
      let nz = z - hit.point.z
      if (hit.dist > 1e-9) {
        nx /= hit.dist
        nz /= hit.dist
      } else {
        const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z) || 1
        nx = -(w.b.z - w.a.z) / len
        nz = (w.b.x - w.a.x) / len
      }
      x = hit.point.x + nx * min
      z = hit.point.z + nz * min
      moved = true
    }
    if (!moved) break
  }
  const out = { x, z }
  return isWalkable(plan, out, radius) ? out : undefined
}

/** Moves from `from` to `to`, sliding along walls; sub-steps so a long move cannot tunnel through a wall. */
export function movePosition(plan: Plan, from: Point, to: Point, radius = WALK_RADIUS): Point {
  const dx = to.x - from.x
  const dz = to.z - from.z
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (radius / 2)))
  let cur = from
  for (let i = 0; i < steps; i++) {
    const next = resolvePosition(plan, { x: cur.x + dx / steps, z: cur.z + dz / steps }, radius)
    if (!next) break
    cur = next
  }
  return cur
}

/** Where "Walk inside" starts: the outline centroid if it is clear of walls, else the clear grid point nearest to it. */
export function startPosition(plan: Plan): Point {
  const c = ringCentroid(plan.outline.outer)
  if (isWalkable(plan, c, START_CLEARANCE)) return c
  const xs = plan.outline.outer.map((p) => p.x)
  const zs = plan.outline.outer.map((p) => p.z)
  for (const clearance of [START_CLEARANCE, WALK_RADIUS]) {
    let best: Point | undefined
    let bestDist = Infinity
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += GRID_STEP) {
      for (let z = Math.min(...zs); z <= Math.max(...zs); z += GRID_STEP) {
        const d = Math.hypot(x - c.x, z - c.z)
        if (d < bestDist && isWalkable(plan, { x, z }, clearance)) {
          best = { x, z }
          bestDist = d
        }
      }
    }
    if (best) return best
  }
  return c
}

/** Yaw (radians, counter-clockwise from north, as three.js rotation.y) that looks along the horizontal direction (dx, dz). */
export function yawOf(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz)
}

/** Yaw from `from` toward the middle of the windows on the outline edge with the most window width; 0 (north) without windows. */
export function windowYaw(plan: Plan, from: Point): number {
  const edges = new Map<string, { ring: number; edge: number; width: number; t: number }>()
  for (const w of plan.windows) {
    const key = `${w.ring}/${w.edge}`
    const e = edges.get(key) ?? { ring: w.ring, edge: w.edge, width: 0, t: 0 }
    e.t += w.t * w.width
    e.width += w.width
    edges.set(key, e)
  }
  let best: { ring: number; edge: number; width: number; t: number } | undefined
  for (const e of edges.values()) if (!best || e.width > best.width) best = e
  if (!best) return 0
  const ring = ringOf(plan, best.ring)
  const a = ring[best.edge]
  const b = ring[(best.edge + 1) % ring.length]
  const t = best.t / best.width
  return yawOf(a.x + (b.x - a.x) * t - from.x, a.z + (b.z - a.z) * t - from.z)
}
