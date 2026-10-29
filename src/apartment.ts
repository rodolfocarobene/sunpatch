import polygonClipping, { type Polygon } from 'polygon-clipping'
import { BoxGeometry, ExtrudeGeometry, Matrix4, Path, PlaneGeometry, Shape, Vector3, type BufferGeometry } from 'three'
import { addsOf, carve, cutsOf, polygonsOf, sparing, toPairs, type Piece } from './edits'
import { clampWindowT } from './editor-geom'
import { extrudeRings } from './footprint'
import type { Building, Point } from './osm'
import { FACADE_THICKNESS, SLAB_THICKNESS, floorBase, ringOf, type Plan } from './plan'

const EPS = 1e-6
const MARGIN = 0.01
/** The apartment floor sits on top of the lower block; this is the gap that avoids coplanar faces. */
const FLOOR_SKIN = 0.02

export interface Opening {
  /** Along the edge, from its first vertex (metres). */
  u0: number
  u1: number
  /** Above the floor (metres). */
  v0: number
  v1: number
}

/** Signed area in (x, z); positive when the interior is on the left of the walking direction. */
function signedArea(ring: Point[]): number {
  let sum = 0
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]
    const q = ring[(i + 1) % ring.length]
    sum += p.x * q.z - q.x * p.z
  }
  return sum / 2
}

/** Window rectangles of one edge that fit inside a wall of the given length and height. */
export function edgeOpenings(plan: Plan, ring: number, edge: number, length: number, height: number): Opening[] {
  const found: Opening[] = []
  for (const w of plan.windows) {
    if (w.ring !== ring || w.edge !== edge) continue
    // Windows saved before the editor kept them clear of the corners are moved in, not dropped.
    const t = clampWindowT(w.t, w.width, length)
    if (t === null) continue
    const u0 = t * length - w.width / 2
    const u1 = u0 + w.width
    const v0 = Math.max(w.sill, MARGIN)
    const v1 = Math.min(w.sill + w.height, height - MARGIN)
    if (v1 - v0 < 0.1) continue
    found.push({ u0, u1, v0, v1 })
  }
  found.sort((a, b) => a.u0 - b.u0)
  return found.filter((o, i) => i === 0 || o.u0 >= found[i - 1].u1 + MARGIN)
}

/** One wall slab with its local frame: x along `along`, y up, z (thickness) along `inward`. */
export interface WallFrame {
  origin: Vector3
  along: Vector3
  inward: Vector3
  length: number
  /** The edge runs against `along`, so edge distances u map to length - u. */
  reversed: boolean
  extendStart: boolean
  extendEnd: boolean
}

/** Frame of the wall on edge `edge` of `ring`, standing on the inner side of the apartment. */
export function wallFrame(plan: Plan, ringIndex: number, edge: number): WallFrame | undefined {
  const ring = ringOf(plan, ringIndex)
  const n = ring.length
  const p = ring[edge]
  const q = ring[(edge + 1) % n]
  const prev = ring[(edge + n - 1) % n]
  const next = ring[(edge + 2) % n]
  const length = Math.hypot(q.x - p.x, q.z - p.z)
  if (length < EPS) return undefined
  // Apartment interior is left of the edge for an outer ring with positive area, right for a hole.
  const side = Math.sign(signedArea(ring)) * (ringIndex === 0 ? 1 : -1)
  const d = new Vector3((q.x - p.x) / length, 0, (q.z - p.z) / length)
  const left = new Vector3(-d.z, 0, d.x)
  const inward = left.clone().multiplyScalar(side)
  const turn = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x)
  // Convex corners are covered by the neighbour's wall; reflex ones need the wall to run on.
  const reflexAtP = turn(prev, p, q) * side <= EPS
  const reflexAtQ = turn(p, q, next) * side <= EPS
  const reversed = side < 0
  return {
    origin: new Vector3(reversed ? q.x : p.x, 0, reversed ? q.z : p.z),
    along: reversed ? d.clone().negate() : d,
    inward,
    length,
    reversed,
    extendStart: reversed ? reflexAtQ : reflexAtP,
    extendEnd: reversed ? reflexAtP : reflexAtQ,
  }
}

function frameMatrix(frame: WallFrame, y: number, alongOffset = 0): Matrix4 {
  const origin = frame.origin.clone().addScaledVector(frame.along, alongOffset)
  origin.y = y
  return new Matrix4().makeBasis(frame.along, new Vector3(0, 1, 0), frame.inward).setPosition(origin)
}

const rect = (u0: number, v0: number, u1: number, v1: number) =>
  new Path().moveTo(u0, v0).lineTo(u1, v0).lineTo(u1, v1).lineTo(u0, v1).closePath()

export interface FacadeWall {
  wall: BufferGeometry
  glass: BufferGeometry[]
}

/** Wall slab on one edge, with a hole per window and a glass pane in each. */
export function facadeWall(plan: Plan, b: Building, ringIndex: number, edge: number): FacadeWall | undefined {
  const frame = wallFrame(plan, ringIndex, edge)
  if (!frame) return undefined
  const base = floorBase(b, plan)
  const height = plan.floorHeight - SLAB_THICKNESS
  const openings = edgeOpenings(plan, ringIndex, edge, frame.length, height)
  const toLocal = (o: Opening) => (frame.reversed ? { ...o, u0: frame.length - o.u1, u1: frame.length - o.u0 } : o)
  const start = frame.extendStart ? -FACADE_THICKNESS : 0
  const end = frame.length + (frame.extendEnd ? FACADE_THICKNESS : 0)
  const shape = new Shape().moveTo(start, 0).lineTo(end, 0).lineTo(end, height).lineTo(start, height).closePath()
  const local = openings.map(toLocal)
  for (const o of local) shape.holes.push(rect(o.u0, o.v0, o.u1, o.v1))
  const wall = new ExtrudeGeometry(shape, { depth: FACADE_THICKNESS, bevelEnabled: false })
  const m = frameMatrix(frame, base)
  wall.applyMatrix4(m)
  const glass = local.map((o) => {
    const pane = new PlaneGeometry(o.u1 - o.u0, o.v1 - o.v0)
    pane.translate((o.u0 + o.u1) / 2, (o.v0 + o.v1) / 2, FACADE_THICKNESS / 2)
    return pane.applyMatrix4(m)
  })
  return { wall, glass }
}

/** Facade walls (and window panes) for every edge of the apartment outline. */
export function facadeWalls(plan: Plan, b: Building): { walls: BufferGeometry[]; glass: BufferGeometry[] } {
  const walls: BufferGeometry[] = []
  const glass: BufferGeometry[] = []
  for (let r = 0; r <= plan.outline.holes.length; r++) {
    const ring = ringOf(plan, r)
    for (let e = 0; e < ring.length; e++) {
      const f = facadeWall(plan, b, r, e)
      if (!f) continue
      walls.push(f.wall)
      glass.push(...f.glass)
    }
  }
  return { walls, glass }
}

/** Interior wall boxes from the floor to the underside of the ceiling slab. */
export function interiorWalls(plan: Plan, b: Building): BufferGeometry[] {
  const base = floorBase(b, plan)
  const height = plan.floorHeight - SLAB_THICKNESS
  const geometries: BufferGeometry[] = []
  for (const w of plan.walls) {
    const length = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z)
    if (length < EPS) continue
    const box = new BoxGeometry(length, height, w.thickness)
    const angle = -Math.atan2(w.b.z - w.a.z, w.b.x - w.a.x)
    box.applyMatrix4(new Matrix4().makeRotationY(angle).setPosition((w.a.x + w.b.x) / 2, base + height / 2, (w.a.z + w.b.z) / 2))
    geometries.push(box)
  }
  return geometries
}

/** Footprint minus apartment outline: what remains of the floor, as outer rings with holes. */
export function restOfFloorPolygons(b: Building, plan: Plan): { outer: Point[]; holes: Point[][] }[] {
  const footprint: Polygon = [toPairs(b.outer), ...b.holes.map(toPairs)]
  const apartment: Polygon = [toPairs(plan.outline.outer), ...plan.outline.holes.map(toPairs)]
  return polygonsOf(polygonClipping.difference(footprint, apartment))
}

export interface ApartmentGeometry {
  /** Building below the floor and the rest of the floor (other apartments): in the building colour. */
  shell: BufferGeometry[]
  /** The block above the ceiling slab: hidden from the camera in cutaway. */
  ceiling: BufferGeometry[]
  /** Apartment floor slab, the surface the sun patches land on. */
  floor: BufferGeometry
  walls: BufferGeometry[]
  glass: BufferGeometry[]
  /** Added prisms (`edits`) reaching below the apartment ceiling slab's underside: always visible. */
  added: BufferGeometry[]
  /** Added prisms entirely above it: hidden from the camera in cutaway, like `ceiling`. */
  addedAbove: BufferGeometry[]
}

/** Vertical extents of the lower block and the upper block around the apartment storey. */
export function remainderRanges(b: Building, plan: Plan): { lower: [number, number]; upper?: [number, number] } {
  const base = floorBase(b, plan)
  const top = base + plan.floorHeight
  const lowerBottom = base - b.minHeight > EPS ? b.minHeight : base - SLAB_THICKNESS
  const upperTop = Math.max(b.height, top)
  return {
    lower: [lowerBottom, base - FLOOR_SKIN],
    upper: upperTop - (top - SLAB_THICKNESS) > EPS ? [top - SLAB_THICKNESS, upperTop] : undefined,
  }
}

const extrudePiece = (p: Piece) => extrudeRings(p.outer, p.holes, p.bottom, p.top)

/** All geometry of the selected building with the apartment carved out and the plan's edits applied; scene coordinates. */
export function apartmentGeometry(b: Building, plan: Plan): ApartmentGeometry {
  const base = floorBase(b, plan)
  const top = base + plan.floorHeight
  const { lower, upper } = remainderRanges(b, plan)
  const cuts = cutsOf(plan.edits)
  // Cuts through the apartment storey spare the apartment's own footprint (its walls follow the outline).
  const apartment: Polygon = [toPairs(plan.outline.outer), ...plan.outline.holes.map(toPairs)]
  const blockCuts = sparing(cuts, apartment, base, top)
  const block = ([y0, y1]: [number, number]) => carve(b.outer, b.holes, y0, y1, blockCuts).map(extrudePiece)
  const shell = block(lower)
  for (const p of restOfFloorPolygons(b, plan)) {
    shell.push(...carve(p.outer, p.holes, base, top - SLAB_THICKNESS, cuts).map(extrudePiece))
  }
  const { walls, glass } = facadeWalls(plan, b)
  const ceilingBottom = top - SLAB_THICKNESS
  const adds = addsOf(plan.edits)
  const prism = (e: (typeof adds)[number]) => extrudeRings(e.outline, [], e.bottom, e.top)
  return {
    shell,
    ceiling: upper ? block(upper) : [],
    floor: extrudeRings(plan.outline.outer, plan.outline.holes, base - FLOOR_SKIN, base),
    walls: [...walls, ...interiorWalls(plan, b)],
    glass,
    added: adds.filter((e) => e.bottom < ceilingBottom - EPS).map(prism),
    addedAbove: adds.filter((e) => e.bottom >= ceilingBottom - EPS).map(prism),
  }
}
