import { wallFrame } from './apartment'
import { clampWindowT, projectOnSegment } from './editor-geom'
import { rotationToward, specOf, type Furniture } from './furniture'
import type { Point } from './osm'
import { FACADE_THICKNESS, SLAB_THICKNESS, type Plan } from './plan'
import { insideOutline, wallsOf } from './walk-geom'

// Window boxes and wall planters: pots hung on the facade under a window, or on a wall inside. They are plain furniture
// placed once (x, z, rot and an absolute height y worked out here), so they stay where they were put when the window or
// the wall is later moved or deleted, and are removed like any other piece.

/** The trough's height: its top sits `MOUNT_GAP` under the sill. */
export const TROUGH_HEIGHT = 0.2
/** A window box is its window's width within these bounds, to 10 cm. */
export const WINDOW_BOX_WIDTH = { min: 0.4, max: 1.6 }
/** Clearance between a hung piece and its wall, and under a sill: enough for the 5 cm and 5 degree rounding of a share link. */
export const MOUNT_GAP = 0.04
/** A wall planter's shelf: this high above the floor when no height is picked, and kept within these heights. */
export const WALL_POT_HEIGHT = { initial: 1.5, min: 0.3, belowCeiling: 1 }
/** The Garden traces a hung pot this far out from its wall, so the spot's small disc (0.3 m) stays clear of the wall. */
const SPOT_OUT = 0.35

const floorTenth = (v: number): number => Math.floor(v * 10 + 1e-6) / 10

/** Window `index` as built (moved in from the corners like the opening): its centre on the facade's outer face, the unit normal out of the building, and the span along the wall. */
export function windowOpening(plan: Plan, index: number): { centre: Point; out: Point; along: Point; width: number; sill: number; height: number } | undefined {
  const w = plan.windows[index]
  const frame = w && wallFrame(plan, w.ring, w.edge)
  if (!frame) return undefined
  const t = clampWindowT(w.t, w.width, frame.length)
  if (t === null) return undefined
  // The frame runs along the edge or against it; either way its origin plus `along` spans the edge.
  const u = frame.reversed ? (1 - t) * frame.length : t * frame.length
  const centre = { x: frame.origin.x + frame.along.x * u, z: frame.origin.z + frame.along.z * u }
  return { centre, out: { x: -frame.inward.x, z: -frame.inward.z }, along: { x: frame.along.x, z: frame.along.z }, width: w.width, sill: w.sill, height: w.height }
}

/** A piece of `kind` with its back against a wall at `face` (normal `n` pointing away from the wall), front toward `n`. */
function hungOn(kind: 'windowbox' | 'wallpot', face: Point, n: Point, y: number, plant: string, w?: number): Furniture {
  const off = specOf(kind).d / 2 + MOUNT_GAP
  const at = { x: face.x + n.x * off, z: face.z + n.z * off }
  return { kind, x: at.x, z: at.z, rot: rotationToward(at, { x: at.x + n.x, z: at.z + n.z }), plant, y, ...(w !== undefined && { w }) }
}

/** A window box of `plant` under window `index` of a plan whose floor is at `base`: centred, outside the facade, its top just under the sill. */
export function windowBoxAt(plan: Plan, base: number, index: number, plant: string): Furniture | undefined {
  const o = windowOpening(plan, index)
  if (!o) return undefined
  const width = Math.min(WINDOW_BOX_WIDTH.max, Math.max(WINDOW_BOX_WIDTH.min, Math.round(o.width * 10) / 10))
  return hungOn('windowbox', o.centre, o.out, floorTenth(base + o.sill - TROUGH_HEIGHT - MOUNT_GAP), plant, width)
}

/**
 * The inner face of the wall at `at` (a point on it, plan metres) seen from the room at `room`: the point on that face and its
 * unit normal into the room. A facade's face is FACADE_THICKNESS in from the outline, an interior wall's half its thickness
 * from its centre line. Undefined when no wall face is within `tol` of `at`, or the face is outside the apartment.
 */
export function wallFaceAt(plan: Plan, at: Point, room: Point, tol: number): { face: Point; n: Point } | undefined {
  let best: { face: Point; n: Point; off: number } | undefined
  for (const w of wallsOf(plan)) {
    const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z)
    if (len < 1e-6) continue
    const hit = projectOnSegment(at, w.a, w.b)
    if (hit.t <= 0 || hit.t >= 1) continue
    // The side of the wall the room is on.
    let n = { x: -(w.b.z - w.a.z) / len, z: (w.b.x - w.a.x) / len }
    if ((room.x - hit.point.x) * n.x + (room.z - hit.point.z) * n.z < 0) n = { x: -n.x, z: -n.z }
    const off = Math.abs((at.x - hit.point.x) * n.x + (at.z - hit.point.z) * n.z - w.reach)
    if (off > tol || (best && off >= best.off)) continue
    const face = { x: hit.point.x + n.x * w.reach, z: hit.point.z + n.z * w.reach }
    if (!insideOutline(plan, { x: face.x + n.x * 0.01, z: face.z + n.z * 0.01 })) continue
    best = { face, n, off }
  }
  return best && { face: best.face, n: best.n }
}

/**
 * A wall planter of `plant` on the wall face found by `wallFaceAt`, its shelf `height` metres above the floor at `base`
 * (to 10 cm, kept between the floor and a metre under the ceiling of a storey `floorHeight` high).
 */
export function wallPotAt(wall: { face: Point; n: Point }, base: number, floorHeight: number, plant: string, height = WALL_POT_HEIGHT.initial): Furniture {
  const top = floorHeight - SLAB_THICKNESS - WALL_POT_HEIGHT.belowCeiling
  const h = Math.max(WALL_POT_HEIGHT.min, Math.min(top, Math.round(height * 10) / 10))
  return hungOn('wallpot', wall.face, wall.n, floorTenth(base + h + 1e-6), plant)
}

/** The point the Garden traces for a hung pot: in front of its wall at the top of its soil. */
export function mountSpot(f: Furniture): { x: number; y: number; z: number } {
  const r = (f.rot * Math.PI) / 180
  const out = SPOT_OUT - specOf(f.kind).d / 2 - MOUNT_GAP
  return { x: f.x - Math.sin(r) * out, y: (f.y ?? 0) + (f.kind === 'windowbox' ? TROUGH_HEIGHT : 0.3), z: f.z + Math.cos(r) * out }
}

type Vec3 = { x: number; y: number; z: number }

/**
 * The window a ray (from `origin` along unit `dir`) meets before `maxDist`, for a plan whose floor is at `base`: the
 * opening on the facade's outer or inner face, a little wider, and from outside reaching 0.4 m under the sill (where a
 * window box hangs). `outside` when the ray comes from outside the building.
 */
export function windowOnRay(plan: Plan, base: number, origin: Vec3, dir: Vec3, maxDist: number): { index: number; outside: boolean } | undefined {
  let best: { index: number; outside: boolean; s: number } | undefined
  plan.windows.forEach((_, index) => {
    const o = windowOpening(plan, index)
    if (!o) return
    const facing = dir.x * o.out.x + dir.z * o.out.z
    if (Math.abs(facing) < 1e-6) return
    const outside = facing < 0
    for (const depth of [0, FACADE_THICKNESS]) {
      const c = { x: o.centre.x - o.out.x * depth, z: o.centre.z - o.out.z * depth }
      const s = ((c.x - origin.x) * o.out.x + (c.z - origin.z) * o.out.z) / facing
      if (s <= 0 || s > maxDist + 0.02 || (best && s >= best.s)) continue
      const p = { x: origin.x + dir.x * s, y: origin.y + dir.y * s, z: origin.z + dir.z * s }
      const u = (p.x - c.x) * o.along.x + (p.z - c.z) * o.along.z
      const v = p.y - base
      if (Math.abs(u) > o.width / 2 + 0.1 || v > o.sill + o.height || v < o.sill - (outside ? 0.4 : 0.05)) continue
      best = { index, outside, s }
    }
  })
  return best && { index: best.index, outside: best.outside }
}

/**
 * The window whose sill, between the facade's outer face and its glass, holds `at` (a point a Garden click hit, scene
 * metres): a pot there stands outside, so the Garden traces in front of the window instead of inside the wall.
 */
export function outerSillAt(plan: Plan, base: number, at: Vec3): number | undefined {
  const i = plan.windows.findIndex((_, index) => {
    const o = windowOpening(plan, index)
    if (!o || Math.abs(at.y - base - o.sill) > 0.05) return false
    const dx = at.x - o.centre.x
    const dz = at.z - o.centre.z
    const inward = -(dx * o.out.x + dz * o.out.z)
    return inward >= -0.01 && inward <= FACADE_THICKNESS / 2 && Math.abs(dx * o.along.x + dz * o.along.z) <= o.width / 2
  })
  return i < 0 ? undefined : i
}
