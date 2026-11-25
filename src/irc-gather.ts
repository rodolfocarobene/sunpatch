import { DoubleSide, Ray, Vector3 } from 'three'
import type { MeshBVH } from 'three-mesh-bvh'
import { cieWeight, EXTERNAL_REFLECTANCE, GLAZING, hemisphereDirs, REFLECTANCE, WORK_PLANE } from './dayfactor'

// Internally reflected light with a falloff: a one-bounce gather over the room's own surfaces, a uniform remainder for
// the higher bounces, and a per-room scale that keeps the BRE split-flux room mean (dayfactor.ts `internalReflected`).
//   E1(point)  = pi * mean over cosine rays of L, L = rho * E_patch / pi      (light from the surface each ray hits)
//              = mean over rays of rho * E_patch                               (rays leaving through glass add 0)
//   E2         = mean(E1) * R / (1 - R)                                        (split-flux series, uniform)
//   IRC(point) = scale * (E1 + E2),  scale = BRE / mean(E1 + E2)               (so the room mean is BRE)
// E_patch is what a surface patch receives directly from the sky and the obstructions, through the glass, as a % of the
// outdoor horizontal illuminance: the same CIE weights, glazing and ERC rule as SC and ERC, with the patch normal in
// place of "up". Patches are made on demand where gather rays land, on a grid of `patchCell` metres, so only the surfaces
// that matter cost anything.

/** Side of a surface patch, metres; coarsened when the apartment has more than `IRC_MAX_PATCHES` of them. */
export const IRC_PATCH_CELL = 0.5
export const IRC_MAX_PATCHES = 2000
/** Rays per patch (its direct light) and per floor point (the gather). */
export const IRC_PATCH_RAYS = 64
export const IRC_GATHER_RAYS = 128
/** Patches are measured this far off their surface, clear of it. */
const LIFT = 0.02
/** Wall patches tell facing directions apart by this many buckets of the full circle. */
const FACING_BUCKETS = 16

export interface IrcRoom {
  /** The BRE internally reflected component of the room, %: 0 for a room without glass. */
  target: number
  /** Area-weighted mean reflectance of the room's surfaces. */
  reflectance: number
}

export interface IrcCalibration {
  /** Mean of the raw first bounce over the room's calibration points, %. */
  rawMean: number
  /** The uniform higher-bounce term before scaling, %. */
  e2: number
  /** Multiplier on E1 + E2; the room mean of the result is the BRE value. */
  scale: number
  /** The BRE value the mean is held to, %. */
  target: number
  /** Added after scaling: 0, except in a room whose gather found no light at all, which falls back to the uniform BRE value. */
  offset: number
}

export interface IrcInput {
  floorY: number
  rooms: IrcRoom[]
  /** Points (x, z each) the room means are taken over, and the room of each. */
  calib: { points: Float32Array; room: Int32Array }
  /** Points to report; when omitted they are the calibration points. */
  points?: Float32Array
  room?: Int32Array
  /** Total surface of the rooms (floor, ceiling, walls), m2: sets the patch size. */
  area: number
  /** Identifies the room means for reuse when only other points change (a new Garden run on the same plan). */
  cacheKey: string
  /** Room means already found for this scene and plan (by another worker): with them only `points` are traced. */
  known?: IrcCalibration[]
}

/** The reflectance of a surface seen with this normal: the ceiling when it faces down, the floor when up, else a wall. */
export function reflectanceOf(ny: number, r = REFLECTANCE): number {
  return ny < -0.7 ? r.ceiling : ny > 0.7 ? r.floor : r.walls
}

/** The patch side for `area` m2 of room surface: 0.5 m, coarser when that would be more than `IRC_MAX_PATCHES` patches. */
export function patchCellFor(area: number): number {
  return Math.max(IRC_PATCH_CELL, Math.sqrt(Math.max(0, area) / IRC_MAX_PATCHES))
}

/** Room means and the scale that holds them to the BRE values; `e1[i]` belongs to room `room[i]`. */
export function calibrate(e1: ArrayLike<number>, room: ArrayLike<number>, rooms: IrcRoom[]): IrcCalibration[] {
  const sum = new Float64Array(rooms.length)
  const n = new Float64Array(rooms.length)
  for (let i = 0; i < e1.length; i++) {
    const k = room[i]
    if (k < 0 || k >= rooms.length) continue
    sum[k] += e1[i]
    n[k]++
  }
  return rooms.map((r, k) => {
    const rawMean = n[k] ? sum[k] / n[k] : 0
    const e2 = rawMean * (r.reflectance / (1 - r.reflectance))
    if (!(r.target > 0)) return { rawMean, e2, scale: 0, target: 0, offset: 0 }
    if (!(rawMean > 0)) return { rawMean, e2: 0, scale: 0, target: r.target, offset: r.target }
    return { rawMean, e2, scale: r.target / (rawMean + e2), target: r.target, offset: 0 }
  })
}

/** The IRC at a point whose raw first bounce is `e1`, in a room calibrated as `c`, %. */
export const ircValue = (e1: number, c: IrcCalibration): number => c.scale * (e1 + c.e2) + c.offset

/** Surface patches with the light they receive directly through the glass, cached by patch. */
export class PatchField {
  private readonly cache = new Map<string, number>()
  private readonly dirs: Float32Array
  private readonly scratch = surfaceScratch()
  constructor(
    private readonly occluders: MeshBVH,
    private readonly glass: MeshBVH,
    readonly cell: number,
    rays = IRC_PATCH_RAYS,
    private readonly glazing = GLAZING,
  ) {
    this.dirs = hemisphereDirs(rays)
  }

  get size(): number {
    return this.cache.size
  }

  /** The direct light the patch under `point` (a hit on a surface facing `normal`, unit) receives, % of the outdoor horizontal illuminance. */
  at(point: Vector3, normal: Vector3): number {
    const c = this.cell
    let key: string
    let x = point.x
    let y = point.y
    let z = point.z
    if (Math.abs(normal.y) > 0.7) {
      const ix = Math.floor(x / c)
      const iz = Math.floor(z / c)
      key = `${normal.y > 0 ? 'f' : 'c'}${ix},${iz},${Math.round(y / 0.05)}`
      x = (ix + 0.5) * c
      z = (iz + 0.5) * c
    } else {
      // A wall: a cell along it and up it, told apart from the parallel face behind it by its offset.
      const tx = -normal.z
      const tz = normal.x
      const len = Math.hypot(tx, tz) || 1
      const s = (x * tx + z * tz) / len
      const is = Math.floor(s / c)
      const iy = Math.floor(y / c)
      const off = Math.round((x * normal.x + z * normal.z) / 0.05)
      const facing = Math.round((Math.atan2(normal.z, normal.x) / (2 * Math.PI)) * FACING_BUCKETS)
      key = `w${facing},${is},${iy},${off}`
      const ds = (is + 0.5) * c - s
      x += (tx / len) * ds
      z += (tz / len) * ds
      y = (iy + 0.5) * c
    }
    const known = this.cache.get(key)
    if (known !== undefined) return known
    const value = this.measure(x, y, z, normal)
    this.cache.set(key, value)
    return value
  }

  /** The patch's direct light (see `surfaceDirect`). */
  private measure(x: number, y: number, z: number, normal: Vector3): number {
    return surfaceDirect(this.occluders, this.glass, x, y, z, normal, this.dirs, this.glazing, this.scratch)
  }
}

/** The sideways axes `t` and `b` of the frame about the unit normal `n`, so that a hemisphere direction's y goes along `n`. */
export function tangentFrame(n: Vector3, t: Vector3, b: Vector3): void {
  // Any unit vector not parallel to the normal gives the sideways axes.
  t.set(Math.abs(n.y) < 0.9 ? 0 : 1, Math.abs(n.y) < 0.9 ? 1 : 0, 0).cross(n).normalize()
  b.copy(n).cross(t)
}

/** Sets `out` to direction `i` of `dirs` (an upper hemisphere, y up) turned into the frame `t`, `n`, `b`. */
export function orientDir(out: Vector3, dirs: ArrayLike<number>, i: number, n: Vector3, t: Vector3, b: Vector3): Vector3 {
  const dx = dirs[i * 3]
  const dy = dirs[i * 3 + 1]
  const dz = dirs[i * 3 + 2]
  return out.set(t.x * dx + n.x * dy + b.x * dz, t.y * dx + n.y * dy + b.y * dz, t.z * dx + n.z * dy + b.z * dz)
}

/** What a ray from a surface meets: the sky through glass, an obstruction beyond the glass, or nothing that lights it (the room first, or no glass). */
export type Seen = 'sky' | 'obstruction' | null

const surfaceScratch = () => ({ n: new Vector3(), t: new Vector3(), b: new Vector3(), d: new Vector3(), ray: new Ray() })

/**
 * The direct daylight on a surface facing unit `normal` (SC + ERC, % of the outdoor horizontal illuminance), from the
 * cosine-distributed rays `dirs` turned about the normal: `see` tells what each ray meets. Sky counts with its CIE weight,
 * which holds for any tilt (an unobstructed horizontal plane averages 1, a vertical one 0.396), and only above the
 * horizon: below it is the ground, no sky and no ERC. An obstruction counts as ERC whatever its height.
 */
export function surfaceDaylight(normal: Vector3, dirs: Float32Array, see: (dir: Vector3) => Seen, glazing = GLAZING, frame = surfaceScratch()): number {
  const rays = dirs.length / 3
  const { t, b, d } = frame
  tangentFrame(normal, t, b)
  let sky = 0
  let obstructed = 0
  for (let i = 0; i < rays; i++) {
    orientDir(d, dirs, i, normal, t, b)
    const seen = see(d)
    if (seen === 'sky') {
      if (d.y > 0) sky += cieWeight(d.y)
    } else if (seen === 'obstruction') obstructed++
  }
  return 100 * glazing * (sky / rays + (EXTERNAL_REFLECTANCE * obstructed) / rays)
}

/**
 * The direct daylight (SC + ERC, %) at a surface point (x, y, z) facing unit `normal`: a wall patch for the IRC gather, or a
 * wall, sill or reveal the user asks about. A ray from just off the surface that crosses a pane before anything else is
 * sky when nothing is beyond the pane and an obstruction when something is; one that meets the room first adds nothing.
 */
export function surfaceDirect(
  occluders: MeshBVH,
  glass: MeshBVH,
  x: number,
  y: number,
  z: number,
  normal: { x: number; y: number; z: number },
  dirs: Float32Array,
  glazing = GLAZING,
  scratch = surfaceScratch(),
): number {
  const { n, ray } = scratch
  n.set(normal.x, normal.y, normal.z)
  ray.origin.set(x + n.x * LIFT, y + n.y * LIFT, z + n.z * LIFT)
  const see = (dir: Vector3): Seen => {
    ray.direction.copy(dir)
    const pane = glass.raycastFirst(ray, DoubleSide)
    if (!pane) return null
    const hit = occluders.raycastFirst(ray, DoubleSide)
    return !hit ? 'sky' : hit.distance > pane.distance ? 'obstruction' : null
  }
  return surfaceDaylight(n, dirs, see, glazing, scratch)
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5))

/**
 * The raw first bounce (%) at a point on the work plane: cosine rays go up, each takes the reflected light of the surface
 * it meets first (`rho * E_patch`); a ray that crosses a window pane before any surface leaves the room and adds nothing.
 * `index` numbers the point, only to turn its ray spiral so that points do not stripe. With `facing` (a unit normal) the
 * point is on a surface facing that way (a wall, a sill): the rays leave from just off it, about its normal.
 */
export function gatherFirstBounce(
  occluders: MeshBVH,
  glass: MeshBVH,
  field: Pick<PatchField, 'at'>,
  x: number,
  y: number,
  z: number,
  dirs: Float32Array,
  index: number,
  facing?: { x: number; y: number; z: number },
): number {
  const samples = dirs.length / 3
  const turn = (index * GOLDEN) % (Math.PI * 2)
  const c = Math.cos(turn)
  const s = Math.sin(turn)
  const ray = new Ray()
  const normal = new Vector3()
  const frame = facing && { n: new Vector3(facing.x, facing.y, facing.z), t: new Vector3(), b: new Vector3() }
  if (frame) tangentFrame(frame.n, frame.t, frame.b)
  ray.origin.set(x, y, z)
  if (frame) ray.origin.addScaledVector(frame.n, LIFT)
  let sum = 0
  for (let i = 0; i < samples; i++) {
    const dx = dirs[i * 3]
    const dz = dirs[i * 3 + 2]
    if (frame) orientDir(ray.direction, dirs, i, frame.n, frame.t, frame.b)
    else ray.direction.set(dx * c - dz * s, dirs[i * 3 + 1], dx * s + dz * c)
    const hit = occluders.raycastFirst(ray, DoubleSide)
    if (!hit || !hit.face) continue
    const pane = glass.raycastFirst(ray, DoubleSide, 0, hit.distance)
    if (pane) continue
    normal.copy(hit.face.normal)
    if (normal.dot(ray.direction) > 0) normal.negate() // the face seen from the room
    sum += reflectanceOf(normal.y) * field.at(hit.point, normal)
  }
  return sum / samples
}

/**
 * The IRC job in steps a worker can interleave: first the calibration points (the room means), then, when `points` differ,
 * the points to report. `step` does up to `n` points and returns the share done, 0..1.
 */
export class IrcRun {
  private readonly dirs: Float32Array
  private readonly y: number
  private readonly calibE1: Float32Array
  private readonly outE1: Float32Array | undefined
  private at = 0
  private calibration: IrcCalibration[] | undefined
  constructor(
    private readonly occluders: MeshBVH,
    private readonly glass: MeshBVH,
    private readonly field: PatchField,
    private readonly input: IrcInput,
    known?: IrcCalibration[],
  ) {
    this.dirs = hemisphereDirs(IRC_GATHER_RAYS)
    this.y = input.floorY + WORK_PLANE
    this.calibE1 = new Float32Array(input.calib.points.length / 2)
    this.outE1 = input.points ? new Float32Array(input.points.length / 2) : undefined
    this.calibration = known
    if (known) this.at = this.calibE1.length // skip the calibration phase
  }

  get units(): number {
    return this.calibE1.length + (this.outE1?.length ?? 0)
  }

  step(n: number): number {
    const nCalib = this.calibE1.length
    const nOut = this.outE1?.length ?? 0
    for (let k = 0; k < n && this.at < nCalib + nOut; k++, this.at++) {
      if (this.at < nCalib) {
        const p = this.input.calib.points
        this.calibE1[this.at] = gatherFirstBounce(this.occluders, this.glass, this.field, p[this.at * 2], this.y, p[this.at * 2 + 1], this.dirs, this.at)
        if (this.at === nCalib - 1) this.calibration = calibrate(this.calibE1, this.input.calib.room, this.input.rooms)
      } else {
        const i = this.at - nCalib
        const p = this.input.points!
        this.outE1![i] = gatherFirstBounce(this.occluders, this.glass, this.field, p[i * 2], this.y, p[i * 2 + 1], this.dirs, i)
      }
    }
    return this.units ? Math.min(1, this.at / this.units) : 1
  }

  /** Share of the points done, 0..1. */
  get progress(): number {
    return this.units ? Math.min(1, this.at / this.units) : 1
  }

  get done(): boolean {
    return this.at >= this.calibE1.length + (this.outE1?.length ?? 0)
  }

  /** The room means and scales (once the calibration points are traced). */
  get rooms(): IrcCalibration[] {
    return this.calibration ?? calibrate(this.calibE1, this.input.calib.room, this.input.rooms)
  }

  /** The IRC at the points to report (the calibration points when none were given), %. */
  result(): Float32Array {
    const cal = this.rooms
    const room = this.input.points ? this.input.room! : this.input.calib.room
    const e1 = this.outE1 ?? this.calibE1
    const out = new Float32Array(e1.length)
    for (let i = 0; i < out.length; i++) out[i] = room[i] >= 0 && room[i] < cal.length ? ircValue(e1[i], cal[room[i]]) : 0
    return out
  }
}
