import type { HeightOverrides } from './heights'
import { project, unproject, type Building, type Origin, type Point } from './osm'

/**
 * An apartment on one floor of the selected building, in scene metres (x = east, z = south)
 * relative to `origin`. Outline rings are the OUTER face of the facade walls; walls are built
 * inward from them.
 */
export interface Plan {
  version: 1
  /** OSM id ("way/123") or tile id of the building the plan was drawn on. */
  buildingId: string
  /** Ids of the OSM polygons that made up the selected building when the plan was saved; absent in older plans. */
  selection?: string[]
  origin: Origin
  /** 0 = ground floor. */
  floor: number
  /** Floor-to-floor height in metres. */
  floorHeight: number
  /** Apartment outline: outer ring plus holes (courtyards, stairwells), no closing point. */
  outline: { outer: Point[]; holes: Point[][] }
  walls: InteriorWall[]
  windows: Window[]
  /** Where "Walk inside" drops you; computed from the plan when absent. */
  viewpoint?: Viewpoint
  /** Manual fixes to the selected building's volume (missing balconies, protruding wall parts). */
  edits?: BuildingEdit[]
  /**
   * The user's own heights for OSM polygons of the area (the selected building and its neighbours), keyed by
   * polygon id; they replace the data's heights in the scene. Absent when there are none (and in older plans).
   */
  heights?: HeightOverrides
  /** Solar panels, anywhere around the building (inside or outside the outline); [] for none. */
  panels: Panel[]
}

/**
 * A row of `count` solar modules side by side. `x`/`z` is the centre of the row's footprint in the plan;
 * `elevation` is the height of the lowest edge above the ground.
 */
export interface Panel {
  id: string
  x: number
  z: number
  /** Height of the lowest edge above the ground, metres. */
  elevation: number
  /** Module size in metres: `width` along the row, `height` up the slope. */
  width: number
  height: number
  /** Degrees from horizontal: 0 is flat, 90 is vertical (railing, facade). */
  tilt: number
  /** Degrees clockwise from north that the front of the panel faces. */
  azimuth: number
  /** Modules in the row, 1 when absent. */
  count?: number
}

export interface Viewpoint {
  x: number
  z: number
  /** Look direction, radians counter-clockwise from north (three.js rotation.y; see walk-geom yawOf). */
  yaw: number
}

/**
 * A prism added to (`add`) or carved out of (`cut`) the selected building, from `bottom` to `top`
 * metres above the ground. Edits apply to the building outside the apartment storey too, so they
 * cast shadows like the rest of it.
 */
export interface BuildingEdit {
  kind: 'add' | 'cut'
  /** Footprint, scene metres, no closing point. */
  outline: Point[]
  bottom: number
  top: number
}

export interface InteriorWall {
  a: Point
  b: Point
  thickness: number
}

export interface Window {
  /** 0 = outline.outer, i > 0 = outline.holes[i - 1]. */
  ring: number
  /** Edge from vertex `edge` to vertex `edge + 1` (wrapping) of that ring. */
  edge: number
  /** Window centre along the edge, 0..1. */
  t: number
  width: number
  /** Height of the window bottom above the floor. */
  sill: number
  height: number
}

export const FACADE_THICKNESS = 0.3
export const SLAB_THICKNESS = 0.3
export const DEFAULT_WALL_THICKNESS = 0.1
export const DEFAULT_WINDOW = { width: 1.2, sill: 0.9, height: 1.4 }
const FALLBACK_FLOOR_HEIGHT = 3

export function levelCount(b: Building): number {
  return b.levels ?? Math.max(1, Math.round((b.height - b.minHeight) / FALLBACK_FLOOR_HEIGHT))
}

export function defaultFloorHeight(b: Building): number {
  return b.levels ? (b.height - b.minHeight) / b.levels : FALLBACK_FLOOR_HEIGHT
}

/** Height of the floor surface (top of the slab below) above the ground. */
export function floorBase(b: Building, plan: Pick<Plan, 'floor' | 'floorHeight'>): number {
  return b.minHeight + plan.floor * plan.floorHeight
}

export function ringOf(plan: Plan, ring: number): Point[] {
  return ring === 0 ? plan.outline.outer : plan.outline.holes[ring - 1]
}

/** A new plan covering the whole floor of `b`, with no walls or windows. */
export function defaultPlan(b: Building, origin: Origin, floor = 0): Plan {
  return {
    version: 1,
    buildingId: b.id,
    ...(b.sources && { selection: b.sources }),
    origin,
    floor: Math.min(floor, levelCount(b) - 1),
    floorHeight: defaultFloorHeight(b),
    outline: { outer: b.outer.map((p) => ({ ...p })), holes: b.holes.map((h) => h.map((p) => ({ ...p }))) },
    walls: [],
    windows: [],
    panels: [],
  }
}

/**
 * The same plan expressed around another scene origin (the origin changes when a building
 * is re-picked, or between the tile preview and the OSM data).
 */
export function rebasePlan(plan: Plan, origin: Origin): Plan {
  if (plan.origin.lat === origin.lat && plan.origin.lon === origin.lon) return plan
  const move = (p: Point): Point => {
    const ll = unproject(p, plan.origin)
    return project(ll.lat, ll.lon, origin)
  }
  return {
    ...plan,
    origin,
    outline: { outer: plan.outline.outer.map(move), holes: plan.outline.holes.map((h) => h.map(move)) },
    walls: plan.walls.map((w) => ({ ...w, a: move(w.a), b: move(w.b) })),
    ...(plan.viewpoint && { viewpoint: { ...plan.viewpoint, ...move(plan.viewpoint) } }),
    panels: plan.panels.map((p) => ({ ...p, ...move(p) })),
    ...(plan.edits && { edits: plan.edits.map((e) => ({ ...e, outline: e.outline.map(move) })) }),
  }
}
