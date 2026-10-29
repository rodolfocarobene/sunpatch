import { describe, expect, it } from 'vitest'
import { daylight, STEP } from './daylight'
import { FACADE_THICKNESS, type Plan } from './plan'
import type { Point } from './osm'
import {
  FULL_SUN_MINUTES,
  SUN_STOPS,
  duration,
  clock,
  floorGrid,
  heatTexels,
  litIntervals,
  sampleAt,
  sampleMinutes,
  spotStats,
  sunColor,
  sunShare,
  sunSlots,
  type Grid,
  type SunMapResult,
} from './sunmap'
import { spotSentence } from './sunmap-popover'

const rect = (x0: number, z0: number, x1: number, z1: number): Point[] => [
  { x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 },
]

const plan = (outer: Point[], holes: Point[][] = [], walls: Plan['walls'] = []): Plan => ({
  version: 1,
  buildingId: 'way/1',
  origin: { lat: 45, lon: 9 },
  floor: 1,
  floorHeight: 3,
  outline: { outer, holes },
  walls,
  windows: [],
  panels: [],
})

const samples = (g: Grid) => Array.from({ length: g.count }, (_, i) => ({ x: g.xs[i], z: g.zs[i] }))

describe('floorGrid', () => {
  it('fills the outline minus the facade thickness on a 0.25 m grid', () => {
    const g = floorGrid(plan(rect(0, 0, 10, 6)))
    expect(g.cell).toBe(0.25)
    for (const p of samples(g)) {
      expect(p.x).toBeGreaterThanOrEqual(FACADE_THICKNESS - 1e-6)
      expect(p.x).toBeLessThanOrEqual(10 - FACADE_THICKNESS + 1e-6)
      expect(p.z).toBeGreaterThanOrEqual(FACADE_THICKNESS - 1e-6)
      expect(p.z).toBeLessThanOrEqual(6 - FACADE_THICKNESS + 1e-6)
    }
    // (10 - 0.6) x (6 - 0.6) m2 at 16 samples per m2, give or take the cells cut by the wall line
    expect(g.count).toBeGreaterThan(780)
    expect(g.count).toBeLessThan(840)
  })

  it('leaves out courtyards and the facade around them', () => {
    const hole = rect(4, 2, 6, 4)
    const g = floorGrid(plan(rect(0, 0, 10, 6), [hole]))
    const full = floorGrid(plan(rect(0, 0, 10, 6)))
    expect(g.count).toBeLessThan(full.count - 60)
    for (const p of samples(g)) {
      const inside =
        p.x > 4 - FACADE_THICKNESS + 1e-6 && p.x < 6 + FACADE_THICKNESS - 1e-6 && p.z > 2 - FACADE_THICKNESS + 1e-6 && p.z < 4 + FACADE_THICKNESS - 1e-6
      expect(inside).toBe(false)
    }
  })

  it('leaves out the footprint of interior walls', () => {
    const wall = { a: { x: 2, z: 3 }, b: { x: 8, z: 3 }, thickness: 0.4 }
    const g = floorGrid(plan(rect(0, 0, 10, 6), [], [wall]))
    const full = floorGrid(plan(rect(0, 0, 10, 6)))
    expect(g.count).toBeLessThan(full.count)
    for (const p of samples(g)) {
      const onWall = p.x >= 2 - 0.2 && p.x <= 8 + 0.2 && Math.abs(p.z - 3) < 0.2 - 1e-6
      expect(onWall).toBe(false)
    }
    // Both rooms keep their samples
    expect(samples(g).some((p) => p.z < 2.5)).toBe(true)
    expect(samples(g).some((p) => p.z > 3.5)).toBe(true)
  })

  it('coarsens the grid for a very large floor and is empty for a sliver thinner than the facade', () => {
    expect(floorGrid(plan(rect(0, 0, 100, 100))).cell).toBeGreaterThan(0.25)
    expect(floorGrid(plan(rect(0, 0, 10, 0.5))).count).toBe(0)
  })

  it('finds the sample nearest to a point, and none away from the floor', () => {
    const g = floorGrid(plan(rect(0, 0, 10, 6)))
    const i = sampleAt(g, 5.02, 3.01)!
    expect(Math.hypot(g.xs[i] - 5.02, g.zs[i] - 3.01)).toBeLessThan(0.2)
    // A click on the wall snaps to the floor beside it; one far outside finds nothing
    expect(sampleAt(g, 0.1, 3)).toBeDefined()
    expect(sampleAt(g, 20, 3)).toBeUndefined()
  })
})

describe('litIntervals', () => {
  const starts = [600, 605, 610, 615, 620, 625, 630]
  it('merges consecutive lit slots into runs', () => {
    expect(litIntervals([1, 1, 0, 1, 1, 1, 0], starts)).toEqual([
      { from: 600, to: 610 },
      { from: 615, to: 630 },
    ])
  })
  it('reports several separate intervals and none for a dark spot', () => {
    expect(litIntervals([1, 0, 1, 0, 1, 0, 1], starts)).toHaveLength(4)
    expect(litIntervals([0, 0, 0, 0, 0, 0, 0], starts)).toEqual([])
  })
  it('does not bridge a gap in the slots (night between two daylight stretches)', () => {
    expect(litIntervals([1, 1], [1430, 5])).toEqual([
      { from: 1430, to: 1435 },
      { from: 5, to: 10 },
    ])
  })
})

describe('sunShare', () => {
  it('is minutes over the daylight minutes, capped at 1, and 0 without daylight', () => {
    expect(sunShare(190, 450)).toBeCloseTo(0.4222, 3)
    expect(sunShare(500, 450)).toBe(1)
    expect(sunShare(10, 0)).toBe(0)
  })
})

describe('sunSlots', () => {
  it('covers daylight on the 5-minute grid, matching sunrise and sunset', () => {
    const day = new Date(2026, 11, 21)
    const slots = sunSlots(day, 45.4642, 9.19)
    const info = daylight(day, 45.4642, 9.19)
    const span = slots.starts[slots.starts.length - 1] + STEP - slots.starts[0]
    // Slots only count the sun above the horizon (not the refraction margin daylight() adds)
    expect(Math.abs(span - (info.sunset! - info.sunrise!))).toBeLessThanOrEqual(15)
    expect(slots.starts.every((m) => m % STEP === 0)).toBe(true)
    expect(slots.dirs.length).toBe(slots.starts.length * 3)
    expect(slots.dirs[1]).toBeGreaterThan(0) // the first direction points above the horizon
  })
  it('is longer in June than in December and empty in polar night', () => {
    const dec = sunSlots(new Date(2026, 11, 21), 45.46, 9.19).starts.length
    const jun = sunSlots(new Date(2026, 5, 21), 45.46, 9.19).starts.length
    expect(jun).toBeGreaterThan(dec * 1.5)
    expect(sunSlots(new Date(2026, 11, 21), 80, 0).starts).toHaveLength(0)
  })
})

describe('result helpers', () => {
  const grid: Grid = {
    cell: 1, minX: 0, minZ: 0, cols: 3, rows: 1, index: Int32Array.from([0, -1, 1]),
    xs: Float32Array.from([0.5, 2.5]), zs: Float32Array.from([0.5, 0.5]), count: 2,
  }
  const starts = [600, 605, 610, 615]
  const result: SunMapResult = { grid, starts, lit: Uint8Array.from([1, 1, 0, 1, 0, 0, 0, 0]), daylightMinutes: 20, ms: 0 }

  it('totals minutes, share and intervals per spot', () => {
    expect(spotStats(result, 0)).toEqual({ minutes: 15, share: 0.75, intervals: [{ from: 600, to: 610 }, { from: 615, to: 620 }] })
    expect(spotStats(result, 1)).toEqual({ minutes: 0, share: 0, intervals: [] })
    expect(Array.from(sampleMinutes(result))).toEqual([15, 0])
  })

  it('says it in words', () => {
    expect(spotSentence(spotStats(result, 0))).toEqual({
      headline: '15 min of direct sun', share: '75% of daylight', intervals: ['10:00–10:10', '10:15–10:20'],
    })
    expect(spotSentence(spotStats(result, 1)).headline).toBe('No direct sun here')
    expect(duration(190)).toBe('3 h 10 min')
    expect(duration(120)).toBe('2 h')
    expect(duration(45)).toBe('45 min')
    expect(clock(965)).toBe('16:05')
  })

  it('paints non-floor cells with the nearest floor colour', () => {
    const texels = heatTexels(grid, Float32Array.from([FULL_SUN_MINUTES, 0]))
    const rgba = (c: number) => Array.from(texels.subarray(c * 4, c * 4 + 4))
    expect(rgba(0)).toEqual([...sunColor(FULL_SUN_MINUTES), 255])
    expect(rgba(2)).toEqual([...sunColor(0), 255])
    // The cell between them (not floor) takes one of its neighbours' colours and is opaque
    expect([[...sunColor(FULL_SUN_MINUTES), 255], [...sunColor(0), 255]]).toContainEqual(rgba(1))
  })
})

describe('sun ramp', () => {
  const luminance = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b
  it('runs from slate to pale yellow and gets lighter at every stop', () => {
    expect(sunColor(0)).toEqual([0x34, 0x40, 0x5a])
    expect(sunColor(FULL_SUN_MINUTES)).toEqual([0xff, 0xf0, 0xbf])
    const lum = SUN_STOPS.map(([, hex]) => luminance([1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))))
    for (let i = 1; i < lum.length; i++) expect(lum[i]).toBeGreaterThan(lum[i - 1])
    expect(sunColor(-1)).toEqual(sunColor(0))
    expect(sunColor(2 * FULL_SUN_MINUTES)).toEqual(sunColor(FULL_SUN_MINUTES))
  })
})
