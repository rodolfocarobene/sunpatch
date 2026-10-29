import { projectOnSegment } from './editor-geom'
import type { Point } from './osm'
import type { Plan } from './plan'
import { DAY_MAX, STEP } from './daylight'
import { sunDirection } from './sun'
import { insideOutline, wallsOf } from './walk-geom'

// The sun map: how long each spot of the apartment floor sees the sun on one day. This file is the pure part
// (sampling grid, time slots, intervals, colours); sunmap-trace.ts casts the rays and sunmap.worker.ts runs it.

/** Distance between floor samples, metres. */
export const CELL = 0.25
/** A very large floor gets coarser cells so the ray count stays bounded. */
const MAX_SAMPLES = 6000
/** Rays start this far above the floor: clear of the slab, below any window sill. */
export const SAMPLE_LIFT = 0.05

export interface Grid {
  cell: number
  /** Scene x and z of the grid corner; cell (c, r) is centred at (minX + (c + 0.5) cell, minZ + (r + 0.5) cell). */
  minX: number
  minZ: number
  cols: number
  rows: number
  /** Per cell: index of its sample, or -1 where the cell is not floor (wall, outside, courtyard). */
  index: Int32Array
  /** Scene position of each sample. */
  xs: Float32Array
  zs: Float32Array
  count: number
}

/** True where a person could stand with their feet on the bare floor: inside the outline and clear of every wall. */
export function isFloor(plan: Plan, p: Point): boolean {
  return insideOutline(plan, p) && wallsOf(plan).every((w) => projectOnSegment(p, w.a, w.b).dist >= w.reach)
}

/**
 * Sample points on a regular grid inside the apartment: the outline minus the facade thickness (and minus the
 * courtyards), excluding the footprint of every interior wall.
 */
export function floorGrid(plan: Plan, cell = CELL): Grid {
  const ring = plan.outline.outer
  let minX = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxZ = -Infinity
  for (const p of ring) {
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    minZ = Math.min(minZ, p.z)
    maxZ = Math.max(maxZ, p.z)
  }
  const area = (maxX - minX) * (maxZ - minZ)
  const size = Math.max(cell, Math.sqrt(area / MAX_SAMPLES))
  const cols = Math.max(1, Math.ceil((maxX - minX) / size))
  const rows = Math.max(1, Math.ceil((maxZ - minZ) / size))
  const index = new Int32Array(cols * rows).fill(-1)
  const xs: number[] = []
  const zs: number[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = { x: minX + (c + 0.5) * size, z: minZ + (r + 0.5) * size }
      if (!isFloor(plan, p)) continue
      index[r * cols + c] = xs.length
      xs.push(p.x)
      zs.push(p.z)
    }
  }
  return { cell: size, minX, minZ, cols, rows, index, xs: Float32Array.from(xs), zs: Float32Array.from(zs), count: xs.length }
}

/** The sample nearest to a scene point, if one lies within `reach` metres (a click on a wall edge snaps to the floor beside it). */
export function sampleAt(grid: Grid, x: number, z: number, reach = 0.6): number | undefined {
  const c0 = Math.floor((x - grid.minX) / grid.cell)
  const r0 = Math.floor((z - grid.minZ) / grid.cell)
  const span = Math.ceil(reach / grid.cell)
  let best: number | undefined
  let bestD = reach * reach
  for (let r = r0 - span; r <= r0 + span; r++) {
    for (let c = c0 - span; c <= c0 + span; c++) {
      if (r < 0 || c < 0 || r >= grid.rows || c >= grid.cols) continue
      const i = grid.index[r * grid.cols + c]
      if (i < 0) continue
      const d = (grid.xs[i] - x) ** 2 + (grid.zs[i] - z) ** 2
      if (d <= bestD) {
        bestD = d
        best = i
      }
    }
  }
  return best
}

// --- time ---------------------------------------------------------------------------------------

/** One time slot of the day: [start, start + STEP) minutes, with the sun direction at its middle. */
export interface Slots {
  /** Start of each slot, minutes of the local day. */
  starts: number[]
  /** Unit vectors toward the sun (x east, y up, z south), three numbers per slot. */
  dirs: Float32Array
}

/**
 * The slots of the local calendar day `day` in which the sun is above the horizon, from sunrise to sunset. Slots
 * sit on the time slider's 5-minute grid and the sun is taken at their middle, so a run of lit slots reads in
 * round times and has no bias at either end.
 */
export function sunSlots(day: Date, lat: number, lon: number): Slots {
  const starts: number[] = []
  const dirs: number[] = []
  for (let m = 0; m <= DAY_MAX; m += STEP) {
    const middle = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, m, STEP * 30)
    const sun = sunDirection(middle, lat, lon)
    if (sun.altitudeDeg <= 0) continue
    starts.push(m)
    dirs.push(sun.vector.x, sun.vector.y, sun.vector.z)
  }
  return { starts, dirs: Float32Array.from(dirs) }
}

export interface Interval {
  /** Minutes of the local day. */
  from: number
  to: number
}

/** Merges the slots flagged in `lit` (one 0/1 per slot) into runs of consecutive slots. */
export function litIntervals(lit: ArrayLike<number>, starts: number[]): Interval[] {
  const runs: Interval[] = []
  for (let i = 0; i < starts.length; i++) {
    if (!lit[i]) continue
    const last = runs[runs.length - 1]
    if (last && last.to === starts[i]) last.to = starts[i] + STEP
    else runs.push({ from: starts[i], to: starts[i] + STEP })
  }
  return runs
}

/** Share of the day's daylight minutes, 0..1 (0 when the sun never rises). */
export const sunShare = (minutes: number, daylightMinutes: number) => (daylightMinutes > 0 ? Math.min(1, minutes / daylightMinutes) : 0)

export interface SunMapResult {
  grid: Grid
  starts: number[]
  /** Per sample, per slot: 1 when the sun reaches it. Sample s, slot i is `lit[s * starts.length + i]`. */
  lit: Uint8Array
  daylightMinutes: number
  /** Wall-clock time the computation took, milliseconds. */
  ms: number
}

export interface SpotStats {
  minutes: number
  share: number
  intervals: Interval[]
}

export function spotStats(result: SunMapResult, sample: number): SpotStats {
  const n = result.starts.length
  const row = result.lit.subarray(sample * n, (sample + 1) * n)
  let count = 0
  for (let i = 0; i < n; i++) count += row[i]
  const minutes = count * STEP
  return { minutes, share: sunShare(minutes, result.daylightMinutes), intervals: litIntervals(row, result.starts) }
}

/** Direct-sun minutes of every sample. */
export function sampleMinutes(result: SunMapResult): Float32Array {
  const n = result.starts.length
  const out = new Float32Array(result.grid.count)
  for (let s = 0; s < out.length; s++) {
    let count = 0
    for (let i = 0; i < n; i++) count += result.lit[s * n + i]
    out[s] = count * STEP
  }
  return out
}

// --- text ---------------------------------------------------------------------------------------

export const clock = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`

/** "3 h 10 min", "2 h", "45 min". */
export function duration(minutes: number): string {
  const total = Math.round(minutes)
  const h = Math.floor(total / 60)
  const m = total % 60
  return h && m ? `${h} h ${m} min` : h ? `${h} h` : `${m} min`
}

// --- colours ------------------------------------------------------------------------------------

/**
 * Sequential ramp for "how much direct sun": deep slate (none) through amber to pale warm yellow (all day).
 * Lightness (OKLCH L about 0.37, 0.49, 0.58, 0.70, 0.83, 0.95) rises at every stop, so the order survives greyscale
 * and colour-blindness, and the light end is the sun.
 */
export const SUN_STOPS: [number, string][] = [
  [0, '#34405a'],
  [0.2, '#5b5f78'],
  [0.4, '#9a6f45'],
  [0.6, '#d98f1c'],
  [0.8, '#f8bc4a'],
  [1, '#fff0bf'],
]

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]

/** Colour of a share of daylight, 0..1, interpolated between the stops. */
export function sunColor(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t))
  let i = 1
  while (i < SUN_STOPS.length - 1 && SUN_STOPS[i][0] < x) i++
  const [t0, c0] = SUN_STOPS[i - 1]
  const [t1, c1] = SUN_STOPS[i]
  const f = (x - t0) / (t1 - t0)
  const a = rgb(c0)
  const b = rgb(c1)
  return [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * f)) as [number, number, number]
}

/** CSS gradient of the ramp, for the legend bar. */
export const sunGradient = () => `linear-gradient(to right, ${SUN_STOPS.map(([t, c]) => `${c} ${t * 100}%`).join(', ')})`

/**
 * RGBA texels (one per grid cell, row 0 = smallest z) of the sun map. Cells that are not floor take the colour of
 * the nearest floor cell, so a smoothly filtered texture does not fade out at the walls.
 */
export function heatTexels(grid: Grid, minutes: Float32Array, daylightMinutes: number): Uint8Array {
  const { cols, rows, index } = grid
  const source = new Int32Array(cols * rows).fill(-1)
  let frontier: number[] = []
  for (let k = 0; k < index.length; k++) {
    if (index[k] >= 0) {
      source[k] = index[k]
      frontier.push(k)
    }
  }
  while (frontier.length) {
    const next: number[] = []
    for (const k of frontier) {
      const c = k % cols
      const r = (k - c) / cols
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr
          const cc = c + dc
          if (rr < 0 || cc < 0 || rr >= rows || cc >= cols || source[rr * cols + cc] >= 0) continue
          source[rr * cols + cc] = source[k]
          next.push(rr * cols + cc)
        }
      }
    }
    frontier = next
  }
  const out = new Uint8Array(cols * rows * 4)
  for (let k = 0; k < source.length; k++) {
    if (source[k] < 0) continue // no floor at all
    const [r, g, b] = sunColor(sunShare(minutes[source[k]], daylightMinutes))
    out.set([r, g, b, 255], k * 4)
  }
  return out
}
