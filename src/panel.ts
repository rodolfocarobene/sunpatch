import { pointInPolygon, type Building, type Point } from './osm'
import { floorBase, type Panel, type Plan } from './plan'
import { distanceToSegment, projectOnSegment, ringSegments } from './editor-geom'

export const PANEL_THICKNESS = 0.04
/** A common 60-cell module, in metres. */
export const DEFAULT_PANEL = { width: 1.13, height: 1.72 }
/** Lowest edge of a panel above the floor it is placed on: about a railing's height. */
export const RAILING_HEIGHT = 1
export const ROOF_TILT = 30
export const GROUND_ELEVATION = 0.5
/** A panel on a facade sits this far outside the wall face, so it does not sink into it. */
export const FACADE_GAP = PANEL_THICKNESS / 2 + 0.01
/** The rotate handle sits this far in front of the panel. */
export const TIP_DISTANCE = 1

const rad = (deg: number): number => (deg * Math.PI) / 180

export const modules = (p: Panel): number => p.count ?? 1
/** Width of the whole row. */
export const rowWidth = (p: Panel): number => p.width * modules(p)
/** Horizontal depth of the panel's footprint. */
export const footprintDepth = (p: Panel): number => p.height * Math.cos(rad(p.tilt))

/** Unit horizontal direction the panel faces, in (x, z): azimuth 0 faces north (-z), 90 east. */
export const facing = (azimuth: number): Point => ({ x: Math.sin(rad(azimuth)), z: -Math.cos(rad(azimuth)) })
/** Unit horizontal direction along the row. */
export const along = (azimuth: number): Point => ({ x: Math.cos(rad(azimuth)), z: Math.sin(rad(azimuth)) })

/** Azimuth in degrees (0..360) of the direction (dx, dz). */
export const azimuthOf = (dx: number, dz: number): number => ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360

export interface Corner3 {
  x: number
  y: number
  z: number
}

/** Corners of the whole row's front face: lower left, lower right, upper right, upper left (seen from the front). */
export function panelCorners(p: Panel): Corner3[] {
  const f = facing(p.azimuth)
  const r = along(p.azimuth)
  const half = rowWidth(p) / 2
  const reach = footprintDepth(p) / 2
  const top = p.elevation + p.height * Math.sin(rad(p.tilt))
  const low = { x: p.x + f.x * reach, z: p.z + f.z * reach }
  const high = { x: p.x - f.x * reach, z: p.z - f.z * reach }
  return [
    { x: low.x - r.x * half, y: p.elevation, z: low.z - r.z * half },
    { x: low.x + r.x * half, y: p.elevation, z: low.z + r.z * half },
    { x: high.x + r.x * half, y: top, z: high.z + r.z * half },
    { x: high.x - r.x * half, y: top, z: high.z - r.z * half },
  ]
}

/** The panel's footprint in the plan, at least `minDepth` deep so a vertical panel is still a visible bar. */
export function panelFootprint(p: Panel, minDepth = 0): Point[] {
  const f = facing(p.azimuth)
  const r = along(p.azimuth)
  const half = rowWidth(p) / 2
  const reach = Math.max(footprintDepth(p), minDepth) / 2
  return [
    { x: p.x + f.x * reach - r.x * half, z: p.z + f.z * reach - r.z * half },
    { x: p.x + f.x * reach + r.x * half, z: p.z + f.z * reach + r.z * half },
    { x: p.x - f.x * reach + r.x * half, z: p.z - f.z * reach + r.z * half },
    { x: p.x - f.x * reach - r.x * half, z: p.z - f.z * reach - r.z * half },
  ]
}

/** The rotate handle: in front of the panel, along its facing direction. */
export function panelTip(p: Panel): Point {
  const f = facing(p.azimuth)
  const d = footprintDepth(p) / 2 + TIP_DISTANCE
  return { x: p.x + f.x * d, z: p.z + f.z * d }
}

/** True when `at` is on the panel's footprint or within `tol` metres of its outline. */
export function hitsPanel(p: Panel, at: Point, tol: number, minDepth = 0): boolean {
  const ring = panelFootprint(p, minDepth)
  return pointInPolygon(at, ring) || ringSegments(ring).some(([a, b]) => distanceToSegment(at, a, b) <= tol)
}

/**
 * Unit normal of edge `edge` of `ring` pointing away from the building: out of an outer ring, into a hole
 * (a courtyard is outside the building too).
 */
export function edgeOutward(ring: Point[], edge: number, isHole: boolean): Point {
  const a = ring[edge]
  const b = ring[(edge + 1) % ring.length]
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1
  const n = { x: (b.z - a.z) / len, z: -(b.x - a.x) / len }
  const probe = { x: (a.x + b.x) / 2 + n.x * 0.01, z: (a.z + b.z) / 2 + n.z * 0.01 }
  const outside = isHole ? pointInPolygon(probe, ring) : !pointInPolygon(probe, ring)
  return outside ? n : { x: -n.x, z: -n.z }
}

export interface PanelSnap {
  /** The panel centre, a little outside the edge. */
  point: Point
  /** Facing the edge's outward normal. */
  azimuth: number
}

/**
 * Snaps `at` to the nearest edge within `tol` of the outer rings and holes given: the point goes on the edge,
 * pushed `FACADE_GAP` outward, and the panel faces outward.
 */
export function snapPanel(at: Point, outers: Point[][], holes: Point[][], tol: number): PanelSnap | undefined {
  let best: { ring: Point[]; edge: number; hole: boolean; point: Point; dist: number } | undefined
  const scan = (ring: Point[], hole: boolean): void => {
    ringSegments(ring).forEach(([a, b], edge) => {
      const hit = projectOnSegment(at, a, b)
      if (hit.dist <= tol && (!best || hit.dist < best.dist)) best = { ring, edge, hole, point: hit.point, dist: hit.dist }
    })
  }
  for (const r of outers) scan(r, false)
  for (const r of holes) scan(r, true)
  if (!best) return undefined
  const n = edgeOutward(best.ring, best.edge, best.hole)
  return {
    point: { x: best.point.x + n.x * FACADE_GAP, z: best.point.z + n.z * FACADE_GAP },
    azimuth: azimuthOf(n.x, n.z),
  }
}

let counter = 0
export const newPanelId = (): string => `pv${Date.now().toString(36)}${(counter++).toString(36)}`

/** A new panel at `at`: on the facade (vertical, facing out, at railing height) when snapped, else a south-facing 30 degree stand. */
export function newPanel(at: Point, building: Building, plan: Plan, snap?: PanelSnap): Panel {
  const elevation = floorBase(building, plan) + RAILING_HEIGHT
  if (snap) return { id: newPanelId(), ...snap.point, elevation, ...DEFAULT_PANEL, tilt: 90, azimuth: snap.azimuth }
  return { id: newPanelId(), x: at.x, z: at.z, elevation, ...DEFAULT_PANEL, tilt: ROOF_TILT, azimuth: 180 }
}

export type PanelPreset = 'railing' | 'roof' | 'ground'

/** The placement presets: tilt and elevation (the module size and facing stay). */
export function presetPatch(kind: PanelPreset, building: Building, plan: Plan): Pick<Panel, 'tilt' | 'elevation'> {
  if (kind === 'railing') return { tilt: 90, elevation: floorBase(building, plan) + RAILING_HEIGHT }
  if (kind === 'roof') return { tilt: ROOF_TILT, elevation: building.height }
  return { tilt: ROOF_TILT, elevation: GROUND_ELEVATION }
}
