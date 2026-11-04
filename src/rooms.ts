import { edgeOpenings } from './apartment'
import { clampWindowT, projectOnSegment } from './editor-geom'
import { internalReflected, meanReflectance, roomSurfaces } from './dayfactor'
import type { IrcCalibration, IrcInput } from './irc-gather'
import { SLAB_THICKNESS, ringOf, type Plan } from './plan'
import { insideOutline } from './walk-geom'

// Rooms of an apartment plan, for the internally reflected light (IRC): the outline minus its courtyards is cut by the
// interior walls into rooms. Method: the floor is rasterised on a fine grid, every interior wall is stamped as a band
// of "barrier" cells, and the connected regions of the remaining floor cells (4-neighbour flood fill) are the rooms.
// Raster rather than exact polygon splitting because hand-drawn plans are messy (a wall that stops 5 cm short of the
// next one, a hair of overshoot, a wall that crosses another), and a flood fill treats all of that the way a person
// would: if you can walk through, it is one room.

/** Cell size of the raster, metres. */
export const ROOM_CELL = 0.1
/**
 * Walls close a gap by this much beyond their own thickness: a wall is stamped as a band reaching its half thickness
 * plus half of this (0.1 m) from its centre line. Two wall ends that stop less than about 0.2 m + thickness apart
 * (0.3 m for a 10 cm wall) therefore seal, which covers slightly imprecise drawing (the editor snaps ends to the outline
 * and to other walls, but only within a few screen pixels). A wall end that stops short of the OUTLINE seals when the gap
 * is under about half of that, as the outline itself adds no band.
 */
export const ROOM_CLOSE_GAP = 0.2
/**
 * A gap wider than this is a doorway: the rooms on its two sides are ONE room for IRC (standard split-flux treats rooms
 * joined by an open doorway as roughly one reflective volume). The raster has one real threshold, its closing band, so
 * in practice a gap wider than about 0.3 to 0.4 m is already open; 0.6 m is the width guaranteed open (a narrow door).
 * Light passing between CLOSED rooms (through a glazed door, say) is ignored: they stay closed.
 */
export const ROOM_DOORWAY_MIN = 0.6
/** Samples along a wall are this far from its centre line (clear of the closing band) when finding which room a face bounds. */
const FACE_OFFSET = 0.25
const MAX_CELLS = 400_000

export interface Room {
  /** Floor area, m2 (the exact apartment floor split in proportion to the raster; wall footprints belong to the room). */
  floor: number
  /** Perimeter wall area: facade, courtyard and interior wall faces bounding the room, x floor height, m2. */
  walls: number
  /** Glass area of the windows on the room's boundary, m2. */
  glass: number
}

export interface Rooms {
  rooms: Room[]
  /** Index of the room at a scene point; a point on a wall or outside the outline takes the nearest room. -1 when there are no rooms. */
  roomAt(x: number, z: number): number
}

/** The room's internally reflected component, %: 0 without glass. */
export function roomIrc(room: Room): number {
  return internalReflected(room.glass, { floor: room.floor, walls: room.walls })
}

/** IRC at a scene point, from the room it lies in. */
export function ircAt(rooms: Rooms, x: number, z: number): number {
  const i = rooms.roomAt(x, z)
  return i < 0 ? 0 : roomIrc(rooms.rooms[i])
}

/**
 * What the worker needs for the gathered IRC: each room's BRE value and mean reflectance, the room of each calibration
 * point (`calib`, x and z each) and, when given, of the points to report, and the total surface (for the patch size).
 */
export function ircInput(rooms: Rooms, floorY: number, calib: Float32Array, points: Float32Array | undefined, cacheKey: string, sceneVersion: number): IrcInput {
  const roomOf = (p: Float32Array) => Int32Array.from({ length: p.length / 2 }, (_, i) => rooms.roomAt(p[i * 2], p[i * 2 + 1]))
  return {
    floorY,
    rooms: rooms.rooms.map((r) => ({ target: roomIrc(r), reflectance: meanReflectance(r) })),
    calib: { points: calib, room: roomOf(calib) },
    ...(points ? { points, room: roomOf(points) } : {}),
    area: rooms.rooms.reduce((sum, r) => sum + 2 * r.floor + r.walls, 0),
    cacheKey,
    ...(points && known.has(`${sceneVersion}|${cacheKey}`) ? { known: known.get(`${sceneVersion}|${cacheKey}`) } : {}),
  }
}

/** The room means a worker found, kept here so another job (the clicked Garden spot, after the whole-area run) need not find them again. */
const known = new Map<string, IrcCalibration[]>()
export function rememberIrc(sceneVersion: number, cacheKey: string, calibration: IrcCalibration[] | undefined): void {
  if (!calibration) return
  known.set(`${sceneVersion}|${cacheKey}`, calibration)
  if (known.size > 8) known.delete(known.keys().next().value!)
}

export function buildRooms(plan: Plan): Rooms {
  const total = roomSurfaces(plan)
  const none: Rooms = { rooms: [], roomAt: () => -1 }
  let minX = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxZ = -Infinity
  for (const p of plan.outline.outer) {
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    minZ = Math.min(minZ, p.z)
    maxZ = Math.max(maxZ, p.z)
  }
  const spanX = maxX - minX
  const spanZ = maxZ - minZ
  if (!(spanX > 0 && spanZ > 0)) return none
  const cell = Math.max(ROOM_CELL, Math.sqrt((spanX * spanZ) / MAX_CELLS))
  const cols = Math.max(1, Math.ceil(spanX / cell))
  const rows = Math.max(1, Math.ceil(spanZ / cell))
  const cx = (c: number) => minX + (c + 0.5) * cell
  const cz = (r: number) => minZ + (r + 0.5) * cell
  const indexAt = (x: number, z: number) => {
    const c = Math.min(cols - 1, Math.max(0, Math.floor((x - minX) / cell)))
    const r = Math.min(rows - 1, Math.max(0, Math.floor((z - minZ) / cell)))
    return r * cols + c
  }

  // Floor cells and barrier cells.
  const inside = new Uint8Array(cols * rows)
  const barrier = new Uint8Array(cols * rows)
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) inside[r * cols + c] = insideOutline(plan, { x: cx(c), z: cz(r) }) ? 1 : 0
  for (const w of plan.walls) {
    const reach = w.thickness / 2 + ROOM_CLOSE_GAP / 2
    const c0 = Math.max(0, Math.floor((Math.min(w.a.x, w.b.x) - reach - minX) / cell))
    const c1 = Math.min(cols - 1, Math.floor((Math.max(w.a.x, w.b.x) + reach - minX) / cell))
    const r0 = Math.max(0, Math.floor((Math.min(w.a.z, w.b.z) - reach - minZ) / cell))
    const r1 = Math.min(rows - 1, Math.floor((Math.max(w.a.z, w.b.z) + reach - minZ) / cell))
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (projectOnSegment({ x: cx(c), z: cz(r) }, w.a, w.b).dist <= reach) barrier[r * cols + c] = 1
      }
    }
  }

  // Flood fill the open floor into regions.
  const region = new Int32Array(cols * rows).fill(-1)
  const queue = new Int32Array(cols * rows)
  let count = 0
  for (let s = 0; s < region.length; s++) {
    if (!inside[s] || barrier[s] || region[s] >= 0) continue
    let head = 0
    let tail = 0
    const visit = (j: number) => {
      if (!inside[j] || barrier[j] || region[j] >= 0) return
      region[j] = count
      queue[tail++] = j
    }
    visit(s)
    while (head < tail) {
      const i = queue[head++]
      const c = i % cols
      const r = (i - c) / cols
      if (c > 0) visit(i - 1)
      if (c < cols - 1) visit(i + 1)
      if (r > 0) visit(i - cols)
      if (r < rows - 1) visit(i + cols)
    }
    count++
  }
  if (count === 0) return none

  // Every remaining cell (wall bands, outside the outline) takes the label of the nearest region, by a multi-source sweep.
  const label = Int32Array.from(region)
  let head = 0
  let tail = 0
  for (let i = 0; i < label.length; i++) if (label[i] >= 0) queue[tail++] = i
  while (head < tail) {
    const i = queue[head++]
    const c = i % cols
    const r = (i - c) / cols
    const spread = (j: number) => {
      if (label[j] >= 0) return
      label[j] = label[i]
      queue[tail++] = j
    }
    if (c > 0) spread(i - 1)
    if (c < cols - 1) spread(i + 1)
    if (r > 0) spread(i - cols)
    if (r < rows - 1) spread(i + cols)
  }
  const roomAt = (x: number, z: number) => label[indexAt(x, z)]

  // Floor: wall footprints inside the outline belong to the room they were labelled with; scaled to the exact floor area.
  const cells = new Array<number>(count).fill(0)
  let insideCells = 0
  for (let i = 0; i < label.length; i++) {
    if (!inside[i]) continue
    cells[label[i]]++
    insideCells++
  }
  const floors = cells.map((n) => (insideCells ? (n / insideCells) * total.floor : 0))

  // Walls: every outline edge and both faces of every interior wall, sampled, credited to the room whose floor they face.
  const wallLength = new Array<number>(count).fill(0)
  const face = (a: { x: number; z: number }, b: { x: number; z: number }, offset: number) => {
    const len = Math.hypot(b.x - a.x, b.z - a.z)
    if (len < 1e-9) return
    const n = Math.max(1, Math.ceil(len / 0.05))
    const nx = -(b.z - a.z) / len
    const nz = (b.x - a.x) / len
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n
      for (const o of [offset, -offset]) {
        const px = a.x + (b.x - a.x) * t + nx * o
        const pz = a.z + (b.z - a.z) * t + nz * o
        if (!insideOutline(plan, { x: px, z: pz })) continue // the far side of a facade or courtyard wall
        const i = indexAt(px, pz)
        if (region[i] >= 0) wallLength[region[i]] += len / n
      }
    }
  }
  for (let ring = 0; ring <= plan.outline.holes.length; ring++) {
    const pts = ringOf(plan, ring)
    pts.forEach((p, e) => face(p, pts[(e + 1) % pts.length], FACE_OFFSET))
  }
  for (const w of plan.walls) face(w.a, w.b, FACE_OFFSET + w.thickness / 2)
  const walls = wallLength.map((l) => l * plan.floorHeight)

  // Glass: each window belongs to the room its edge looks into.
  const glass = new Array<number>(count).fill(0)
  const paneHeight = plan.floorHeight - SLAB_THICKNESS
  for (const w of plan.windows) {
    const pts = ringOf(plan, w.ring)
    const a = pts?.[w.edge]
    const b = pts?.[(w.edge + 1) % (pts?.length ?? 1)]
    if (!a || !b) continue
    const len = Math.hypot(b.x - a.x, b.z - a.z)
    if (len < 1e-9) continue
    const t = clampWindowT(w.t, w.width, len) ?? w.t
    const mx = a.x + (b.x - a.x) * t
    const mz = a.z + (b.z - a.z) * t
    const nx = -(b.z - a.z) / len
    const nz = (b.x - a.x) / len
    const into = [FACE_OFFSET, -FACE_OFFSET].map((o) => indexAt(mx + nx * o, mz + nz * o))
    const i = into.find((j) => region[j] >= 0) ?? into.find((j) => inside[j])
    if (i === undefined) continue
    const area = edgeOpenings({ ...plan, windows: [w] }, w.ring, w.edge, len, paneHeight).reduce((s, o) => s + (o.u1 - o.u0) * (o.v1 - o.v0), 0)
    glass[label[i]] += area
  }

  return { rooms: floors.map((floor, i) => ({ floor, walls: walls[i], glass: glass[i] })), roomAt }
}

let last: { key: string; rooms: Rooms } | undefined

/** A short fingerprint of everything the rooms (and so their IRC) depend on in a plan. */
export function roomsKey(plan: Plan): string {
  const text = JSON.stringify([plan.outline, plan.walls, plan.windows, plan.floorHeight])
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return `${(h >>> 0).toString(36)}.${text.length}`
}

/** `buildRooms`, remembering the last plan: the key is every part of the plan the rooms depend on. */
export function roomsOf(plan: Plan): Rooms {
  const key = JSON.stringify([plan.outline, plan.walls, plan.windows, plan.floorHeight])
  if (last?.key === key) return last.rooms
  const rooms = buildRooms(plan)
  last = { key, rooms }
  return rooms
}
