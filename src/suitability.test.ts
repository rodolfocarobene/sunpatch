import { describe, expect, it } from 'vitest'
import { BoxGeometry, Mesh } from 'three'
import { buildingContains, type Building } from './osm'
import { mergeSelection } from './block'
import { DEFAULT_PANEL, FACADE_GAP, GROUND_ELEVATION, ROOF_TILT, presetPatch } from './panel'
import { yearSlots } from './panel-shade'
import { buildBvh, collectOccluders } from './sunmap-trace'
import { defaultPlan } from './plan'
import {
  GROUND_MARGIN, GROUND_REACH, IRRADIATION_STRIDE, SUITABILITY_SLOT_MINUTES, facadeSamples, groundSamples, panelFor, rayInputs, roofSamples,
  rampScale, suitabilityColor, suitabilityText, surfaceEnergy, surfaceLabel, surfaceSamples, traceSamples, type SurfaceSample,
} from './suitability'

const MILAN = { lat: 45.4642, lon: 9.19 }
const rect = (id: string, x0: number, z0: number, x1: number, z1: number, height: number, minHeight = 0): Building => ({
  id, outer: [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }], holes: [], minHeight, height, heightSource: 'tag', tags: {},
})
/** Triangles of a box: centre x, centre z, width, depth, height (standing on the ground). */
const box = (x: number, z: number, w: number, d: number, h: number): Float32Array => {
  const mesh = new Mesh(new BoxGeometry(w, h, d))
  mesh.position.set(x, h / 2, z)
  mesh.castShadow = true
  return collectOccluders([mesh])
}
const join = (...parts: Float32Array[]): Float32Array => {
  const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    all.set(p, at)
    at += p.length
  }
  return all
}
const slots = yearSlots(MILAN.lat, MILAN.lon, 2025, SUITABILITY_SLOT_MINUTES)

/** Mean ideal energy of the samples, kWh/kWp/yr, with these triangles as obstacles. */
function mean(samples: SurfaceSample[], triangles: Float32Array): number {
  const irr = traceSamples(buildBvh(triangles), rayInputs(samples), slots, SUITABILITY_SLOT_MINUTES, 0, samples.length)
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += surfaceEnergy(irr, i * IRRADIATION_STRIDE).ideal
  return sum / samples.length
}

describe('facadeSamples', () => {
  const a = rect('a', 0, 0, 10, 8, 9)
  const b = rect('b', 10, 0, 20, 8, 12) // shares a party wall with a
  const merged = mergeSelection([a, b], a, {})

  it('samples about 1 m x 1 m from the ground to the eaves, facing out', () => {
    const s = facadeSamples(rect('r', 0, 0, 10, 4, 6), [])
    expect(s.length).toBe((10 + 4) * 2 * 6)
    expect(Math.min(...s.map((q) => q.y))).toBeCloseTo(0.5)
    expect(Math.max(...s.map((q) => q.y))).toBeCloseTo(5.5)
    const south = s.filter((q) => q.z === 4)
    expect(south.length).toBe(10 * 6)
    expect(south.every((q) => q.azimuth === 180 && q.tilt === 90)).toBe(true)
  })

  it('stays on the outer boundary of the merged footprint, with no party wall', () => {
    expect(merged.members?.length).toBe(2)
    const s = facadeSamples(merged, [])
    expect(s.some((q) => Math.abs(q.x - 10) < 0.01)).toBe(false)
    // The left half is 9 m high, the right half 12 m.
    expect(s.filter((q) => q.x < 10).every((q) => q.top === 9)).toBe(true)
    expect(s.filter((q) => q.x > 10).every((q) => q.top === 12)).toBe(true)
    expect(s.length).toBe(10 * 9 * 2 + 10 * 12 * 2 + 8 * 9 + 8 * 12)
  })

  it('drops wall pressed against an unselected taller neighbour', () => {
    const neighbour = rect('n', 10, 0, 20, 8, 20)
    const s = facadeSamples(a, [neighbour])
    expect(s.some((q) => Math.abs(q.x - 10) < 0.01)).toBe(false)
    expect(s.some((q) => q.x === 0)).toBe(true)
  })
})

describe('roofSamples', () => {
  const a = rect('a', 0, 0, 10, 8, 9)
  const merged = mergeSelection([a, rect('b', 10, 0, 20, 8, 12)], a, {})

  it('puts each member on a grid at its own height', () => {
    const s = roofSamples(merged, 180)
    expect(new Set(s.map((q) => q.y))).toEqual(new Set([9, 12]))
    expect(s.filter((q) => q.y === 9).every((q) => q.x < 10)).toBe(true)
    expect(s.filter((q) => q.y === 12).every((q) => q.x > 10)).toBe(true)
    expect(s.every((q) => q.tilt === 30 && q.azimuth === 180 && q.kind === 'roof')).toBe(true)
    expect(s.length).toBeGreaterThan(100)
  })

  it('is inside the building and clear of the edge', () => {
    const b = rect('r', 0, 0, 10, 8, 6)
    for (const q of roofSamples(b, 180)) {
      expect(buildingContains(b, q)).toBe(true)
      expect(Math.min(q.x, 10 - q.x, q.z, 8 - q.z)).toBeGreaterThanOrEqual(0.3)
    }
  })
})

describe('groundSamples', () => {
  const own = rect('own', 0, 0, 10, 8, 9)
  const neighbour = rect('n', 14, 0, 24, 8, 12)

  it('forms a ring around the building, outside every footprint', () => {
    const s = groundSamples(own, [own, neighbour], 180)
    expect(s.length).toBeGreaterThan(100)
    for (const q of s) {
      expect(buildingContains(own, q) || buildingContains(neighbour, q)).toBe(false)
      const dx = Math.max(0 - q.x, q.x - 10, 0)
      const dz = Math.max(0 - q.z, q.z - 8, 0)
      expect(Math.hypot(dx, dz)).toBeLessThanOrEqual(GROUND_REACH)
    }
    expect(s.some((q) => q.x >= 14 - GROUND_MARGIN && q.x <= 24 + GROUND_MARGIN && q.z >= 0 && q.z <= 8)).toBe(false)
    expect(s.some((q) => q.x > 25 && q.z >= 0 && q.z <= 8)).toBe(true) // beyond the neighbour it is ground again
  })

  it('surfaceSamples combines the three; stands face south in Milan and north in the south', () => {
    const milan = surfaceSamples(own, [own, neighbour], 45)
    expect(new Set(milan.map((q) => q.kind))).toEqual(new Set(['facade', 'roof', 'ground']))
    expect(milan.filter((q) => q.kind !== 'facade').every((q) => q.azimuth === 180)).toBe(true)
    expect(surfaceSamples(own, [own], -33).filter((q) => q.kind === 'roof').every((q) => q.azimuth === 0)).toBe(true)
  })
})

describe('annual energy per kWp', () => {
  const lone = rect('lone', -5, -4, 5, 4, 9)
  const house = box(0, 0, 10, 8, 9)

  it('an open south facade beats a north facade in Milan', () => {
    const s = facadeSamples(lone, [])
    expect(mean(s.filter((q) => q.azimuth === 180), house)).toBeGreaterThan(mean(s.filter((q) => q.azimuth === 0), house) * 1.5)
  })

  it('a 30 degree south roof beats a vertical south facade', () => {
    const roof = mean(roofSamples(lone, 180), house)
    expect(roof).toBeGreaterThan(mean(facadeSamples(lone, []).filter((q) => q.azimuth === 180), house))
    expect(roof).toBeGreaterThan(1500) // clear sky: about 1,800 kWh/kWp
    expect(roof).toBeLessThan(2200)
  })

  it('a tall obstacle south of the ground ring lowers its scores', () => {
    const ring = groundSamples(lone, [lone], 180)
    const slab = box(0, 9, 30, 2, 25) // 25 m high, 9 m south of the building's centre
    expect(mean(ring, join(house, slab))).toBeLessThan(mean(ring, house) * 0.97)
    const north = ring.filter((q) => q.z < -6)
    expect(mean(north, join(house, slab))).toBeGreaterThan(0)
  })

  it('has a weather figure when the climate is known', () => {
    const roof = roofSamples(lone, 180).slice(0, 3)
    const irr = traceSamples(buildBvh(house), rayInputs(roof), slots, SUITABILITY_SLOT_MINUTES, 0, 3)
    const e = surfaceEnergy(irr, 0, undefined, new Array(12).fill(0.7))
    expect(e.weather).toBeCloseTo(e.ideal * 0.7, 3)
    expect(surfaceEnergy(irr, 0).weather).toBeUndefined()
  })
})

describe('place a panel preset', () => {
  const b = rect('r', 0, 0, 10, 8, 9)
  const plan = defaultPlan(b, { lat: 45, lon: 9 })

  it('facade: vertical, facing out, at the spot just off the wall', () => {
    const p = panelFor({ kind: 'facade', x: 10, y: 4.5, z: 3.5, azimuth: 90, tilt: 90, size: 1, top: 9 }, 'x')
    expect(p).toMatchObject({ tilt: 90, azimuth: 90, ...DEFAULT_PANEL })
    expect(p.x).toBeCloseTo(10 + FACADE_GAP)
    expect(p.z).toBeCloseTo(3.5)
    expect(p.elevation).toBeCloseTo(4.5 - DEFAULT_PANEL.height / 2)
    expect(panelFor({ kind: 'facade', x: 0, y: 8.5, z: 0, azimuth: 180, tilt: 90, size: 1, top: 9 }, 'y').elevation).toBeCloseTo(9 - DEFAULT_PANEL.height)
    expect(panelFor({ kind: 'facade', x: 0, y: 0.5, z: 0, azimuth: 180, tilt: 90, size: 1, top: 9 }, 'y').elevation).toBe(0)
  })

  it('roof: the roof stand at the roof height; ground: a stand at ground level', () => {
    const roof = panelFor({ kind: 'roof', x: 3, y: 9, z: 4, azimuth: 180, tilt: 30, size: 1, top: 9 }, 'r')
    expect(roof).toMatchObject({ x: 3, z: 4, tilt: ROOF_TILT, azimuth: 180, elevation: presetPatch('roof', b, plan).elevation })
    const ground = panelFor({ kind: 'ground', x: -6, y: 0, z: 2, azimuth: 0, tilt: 30, size: 2, top: 0 }, 'g')
    expect(ground).toMatchObject({ x: -6, z: 2, tilt: 30, azimuth: 0, elevation: GROUND_ELEVATION })
  })

  it('labels the surfaces', () => {
    expect(surfaceLabel({ kind: 'roof', azimuth: 180, tilt: 30, y: 9 })).toBe('Roof, 30° south')
    expect(surfaceLabel({ kind: 'facade', azimuth: 225, tilt: 90, y: 6.5 })).toBe('Facade facing south-west, 7 m up')
  })
})

describe('legend and popover text', () => {
  it('rounds the ramp up to 250 with ticks every 250 or 500', () => {
    expect(rampScale([100, 1390])).toEqual({ max: 1500, ticks: [0, 500, 1000, 1500] })
    expect(rampScale([100, 900])).toEqual({ max: 1000, ticks: [0, 250, 500, 750, 1000] })
    expect(rampScale([10]).max).toBe(500)
  })

  it('colours the low end dark and the top light, like the sun map', () => {
    const lightness = (c: number[]) => c[0] + c[1] + c[2]
    expect(lightness(suitabilityColor(0, 1500))).toBeLessThan(lightness(suitabilityColor(750, 1500)))
    expect(lightness(suitabilityColor(750, 1500))).toBeLessThan(lightness(suitabilityColor(5000, 1500)))
  })

  it('says the figure with weather, the ideal and the shading loss, or labels the clear-sky fallback', () => {
    const roof = { kind: 'roof' as const, x: 0, y: 9, z: 0, azimuth: 180, tilt: 30, size: 1, top: 9 }
    expect(suitabilityText(roof, { ideal: 1840, weather: 1387, shadingShare: 0.04 })).toEqual({
      title: 'Roof, 30\u00b0 south',
      figure: '~1,390 kWh/kWp/yr',
      detail: 'with local weather (ideal 1,840) \u00b7 shading loss 4%',
    })
    const clear = suitabilityText(roof, { ideal: 1840, shadingShare: 0.001 })
    expect(clear.figure).toBe('~1,840 kWh/kWp/yr')
    expect(clear.detail).toBe('clear sky, no weather data \u00b7 shading loss <1%')
  })
})
