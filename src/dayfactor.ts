import type { Point } from './osm'
import type { Plan } from './plan'

// Daylight factor (DF): an ESTIMATE of the indirect light in the apartment under a CIE overcast sky, as a % of the
// light outdoors on open ground. It is its own layer and never enters the direct-sun numbers. The model is the BRE
// split-flux method, DF = SC + ERC + IRC; this file is the pure part (constants, weights, IRC, bands, colours),
// dayfactor-trace.ts casts the rays and sunmap.worker.ts runs it.

/** Height of the work plane above the floor (the standard BRE / CIBSE height of a desk). */
export const WORK_PLANE = 0.85
/** Diffuse transmittance of ordinary clear double glazing. */
export const GLASS_TRANSMITTANCE = 0.7
/** Frames, glazing bars and dirt on the glass. */
export const MAINTENANCE = 0.8
/** The glass and frame factors together, applied to SC, ERC and IRC. */
export const GLAZING = GLASS_TRANSMITTANCE * MAINTENANCE
/** The clean-glass transmittance built into the BRE IRC formula. */
const CLEAN_GLASS = 0.85
/** Luminance of an obstruction (a neighbour's facade) as a fraction of the average sky luminance: the usual simple rule. */
export const EXTERNAL_REFLECTANCE = 0.2
/** BRE's coefficient C for an unobstructed view of the sky; it falls as the obstruction angle grows (not measured here, so 39 always). */
export const C_UNOBSTRUCTED = 39
/** Default reflectances of the room's surfaces. */
export const REFLECTANCE = { floor: 0.3, walls: 0.5, ceiling: 0.7 }
/** Directions per point; picked by timing the Milan example (see ARCHITECTURE). */
export const HEMISPHERE_SAMPLES = 384
/** Distance between daylight points: coarser than the sun map's 0.25 m, as the answer varies slowly. */
export const DAYLIGHT_CELL = 0.5

/**
 * Weight of a sky direction with sine of altitude `sinAlt` for cosine-distributed samples (the rays), so that the
 * mean weight over the samples is the sky component as a fraction of the horizontal illuminance outdoors. CIE
 * overcast luminance is L(a) = Lz (1 + 2 sin a) / 3; a horizontal plane under the whole sky gets E = 7 pi / 9 Lz,
 * and the cosine-weighted mean of (1 + 2 sin a) is 7 / 3, so the weight is 3 (1 + 2 sin a) / 7 and an unobstructed
 * point averages exactly 1.
 */
export const cieWeight = (sinAlt: number) => (3 * (1 + 2 * sinAlt)) / 7

/** Horizontal illuminance under the CIE overcast sky per unit zenith luminance, by quadrature: 7 pi / 9. */
export const OVERCAST_HORIZONTAL = (7 * Math.PI) / 9

/**
 * `n` cosine-distributed directions on the upper hemisphere (x, y up, z; three numbers each), a spiral of equal-area
 * rings so they are even rather than random. `turn` rotates the spiral about the vertical.
 */
export function hemisphereDirs(n: number, turn = 0): Float32Array {
  const out = new Float32Array(n * 3)
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt((i + 0.5) / n)
    const phi = i * golden + turn
    out.set([r * Math.cos(phi), Math.sqrt(1 - r * r), r * Math.sin(phi)], i * 3)
  }
  return out
}

// --- internally reflected component ----------------------------------------------------------------

export interface RoomSurfaces {
  /** Floor area of the outline minus its holes, m2. */
  floor: number
  /** Outer and hole walls: perimeter x floor height, m2 (interior walls are not counted: the apartment is one room). */
  walls: number
}

const ringArea = (ring: Point[]) => {
  let sum = 0
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]
    const q = ring[(i + 1) % ring.length]
    sum += p.x * q.z - q.x * p.z
  }
  return Math.abs(sum) / 2
}
const ringLength = (ring: Point[]) =>
  ring.reduce((sum, p, i) => sum + Math.hypot(ring[(i + 1) % ring.length].x - p.x, ring[(i + 1) % ring.length].z - p.z), 0)

export function roomSurfaces(plan: Plan): RoomSurfaces {
  const { outer, holes } = plan.outline
  return {
    floor: ringArea(outer) - holes.reduce((sum, h) => sum + ringArea(h), 0),
    walls: [outer, ...holes].reduce((sum, r) => sum + ringLength(r), 0) * plan.floorHeight,
  }
}

/**
 * The BRE split-flux internally reflected component, as a % of the outdoor horizontal illuminance, constant over
 * the room: IRC = 0.85 W / (A (1 - R)) (C R_fw + 5 R_cw), with W the glass area, A the total surface (floor, ceiling,
 * walls), R their area-weighted mean reflectance, R_fw that of the floor and the lower half of the walls, R_cw that
 * of the ceiling and the upper half (the windows' mid-height splits the walls). The 0.85 is the formula's own clean-glass
 * transmittance, so `glazing` (transmittance x maintenance) enters relative to it rather than on top of it.
 */
export function internalReflected(glassArea: number, room: RoomSurfaces, c = C_UNOBSTRUCTED, glazing = GLAZING, r = REFLECTANCE): number {
  const total = 2 * room.floor + room.walls
  if (glassArea <= 0 || total <= 0) return 0
  const mean = (r.floor * room.floor + r.ceiling * room.floor + r.walls * room.walls) / total
  const half = room.walls / 2
  const lowerArea = room.floor + half
  const fw = (r.floor * room.floor + r.walls * half) / lowerArea
  const cw = (r.ceiling * room.floor + r.walls * half) / lowerArea
  return ((0.85 * glassArea) / (total * (1 - mean))) * (c * fw + 5 * cw) * (glazing / CLEAN_GLASS)
}

/** The area-weighted mean reflectance of a room's surfaces (floor, ceiling, walls): the R of the split-flux series. */
export function meanReflectance(room: RoomSurfaces, r = REFLECTANCE): number {
  const total = 2 * room.floor + room.walls
  return total > 0 ? (r.floor * room.floor + r.ceiling * room.floor + r.walls * room.walls) / total : 0
}

/** The rays' contribution at one point, in %: SC from sky seen through glass, ERC from obstructions seen through glass. */
export function sampleDaylight(skyWeights: number, obstructedFraction: number, glazing = GLAZING): { sc: number; erc: number } {
  return { sc: 100 * glazing * skyWeights, erc: 100 * glazing * EXTERNAL_REFLECTANCE * obstructedFraction }
}

// --- bands -----------------------------------------------------------------------------------------

export type Band = 'dim' | 'fair' | 'bright' | 'veryBright'
/** Lower edges (%) of fair, bright and very bright, as used in daylighting practice. */
export const BAND_EDGES = [1, 2, 5]
export const BANDS: Band[] = ['dim', 'fair', 'bright', 'veryBright']

export function bandOf(df: number): Band {
  return df < BAND_EDGES[0] ? 'dim' : df < BAND_EDGES[1] ? 'fair' : df < BAND_EDGES[2] ? 'bright' : 'veryBright'
}

export interface DaylightSummary {
  mean: number
  /** Share of the floor below 1 %, 0..1. */
  dimShare: number
}

export function summarize(values: ArrayLike<number>): DaylightSummary {
  let sum = 0
  let dim = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
    if (bandOf(values[i]) === 'dim') dim++
  }
  return { mean: values.length ? sum / values.length : 0, dimShare: values.length ? dim / values.length : 0 }
}

// --- colours ---------------------------------------------------------------------------------------

/** Cool ramp (navy slate to near white), deliberately unlike the sun map's amber: this is not sun. */
export const DAYLIGHT_STOPS: [number, string][] = [
  [0, '#1b2a41'],
  [0.25, '#3b5878'],
  [0.5, '#6d9bb5'],
  [0.75, '#b4d6df'],
  [1, '#f1fafc'],
]
/** DF at which the ramp ends (the lightest colour). */
export const DAYLIGHT_TOP = 8

/** Position 0..1 on the ramp: each of the four bands takes a quarter, so the band edges sit at fixed places (0, 1, 2, 5, 8 %). */
export function rampPosition(df: number): number {
  const edges = [0, ...BAND_EDGES, DAYLIGHT_TOP]
  const v = Math.min(DAYLIGHT_TOP, Math.max(0, df))
  let i = 0
  while (i < 3 && v >= edges[i + 1]) i++
  return (i + (v - edges[i]) / (edges[i + 1] - edges[i])) / 4
}

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]

export function daylightColor(df: number): [number, number, number] {
  const x = rampPosition(df)
  let i = 1
  while (i < DAYLIGHT_STOPS.length - 1 && DAYLIGHT_STOPS[i][0] < x) i++
  const [t0, c0] = DAYLIGHT_STOPS[i - 1]
  const [t1, c1] = DAYLIGHT_STOPS[i]
  const f = (x - t0) / (t1 - t0)
  const a = rgb(c0)
  const b = rgb(c1)
  return [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * f)) as [number, number, number]
}

export const daylightGradient = () => `linear-gradient(to right, ${DAYLIGHT_STOPS.map(([t, c]) => `${c} ${t * 100}%`).join(', ')})`
