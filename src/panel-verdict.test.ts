import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/nasa-power-milan.json'
import type { Building } from './osm'
import type { Panel } from './plan'
import { DAYS_IN_MONTH, shadePanel, yearSlots } from './panel-shade'
import { panelInside, referenceEnergy, referenceLine, verdict } from './panel-verdict'
import { DEFAULT_ASSUMPTIONS, panelEnergy, type PanelEnergy } from './solar'
import { buildBvh } from './sunmap-trace'
import { parseClimate } from './weather'

const MILAN = { lat: 45.4627, lon: 9.191 }
const climate = parseClimate(fixture)
const panel: Panel = { id: 'p', x: 3, z: 4, elevation: 5, width: 1.13, height: 1.72, tilt: 90, azimuth: 90 }

const energy = (over: Partial<PanelEnergy> = {}): PanelEnergy => ({
  kwp: 0.4, monthIdeal: [], ideal: 750, weather: 568, idealOpen: 760, shadingCost: 5, shadingShare: 0.007, ...over,
})
const input = (over: Partial<Parameters<typeof verdict>[0]> = {}) => ({ energy: energy(), weather: 'ready' as const, shadingLoss: 0.05, inside: false, ...over })

const square = (half: number): Building => ({
  id: 'way/1', outer: [{ x: -half, z: -half }, { x: half, z: -half }, { x: half, z: half }, { x: -half, z: half }], holes: [],
  minHeight: 0, height: 12, heightSource: 'tag', tags: {},
})

describe('verdict sentence', () => {
  it('leads with the yearly energy, its share of the ideal and the cost of shading', () => {
    const v = verdict(input({ energy: energy({ shadingShare: 0.004 }) }))
    expect(v).toEqual({ sentence: 'About 568 kWh a year with local weather, 76% of the ideal. Shading costs under 1%.', warning: false })
  })

  it('gives the shading as a percentage, or says nothing shades the panel', () => {
    expect(verdict(input({ energy: energy({ shadingShare: 0.08, shadingCost: 60 }) })).sentence).toContain('Shading costs 8%.')
    expect(verdict(input({ energy: energy({ shadingShare: 0, shadingCost: 0 }) })).sentence).toContain('Nothing shades it.')
  })

  it('falls back to the clear-sky figure while the weather loads or when it is unavailable', () => {
    expect(verdict(input({ weather: 'loading' })).sentence).toMatch(/^About 750 kWh a year on a clear sky\..*Loading local weather/)
    expect(verdict(input({ weather: 'error' })).sentence).toMatch(/^About 750 kWh a year on a clear sky\..*unavailable/)
  })
})

describe('shade warning', () => {
  it('warns from 95% lost to shading and not below', () => {
    expect(verdict(input({ shadingLoss: 0.949 })).warning).toBe(false)
    const v = verdict(input({ shadingLoss: 0.95 }))
    expect(v).toEqual({ sentence: 'This panel is almost always in shade. Is it inside the building?', warning: true })
  })

  it('warns when the panel is inside the building, whatever the loss', () => {
    const v = verdict(input({ inside: true }))
    expect(v.warning).toBe(true)
    expect(v.sentence).toContain('inside the building')
  })

  it('finds a panel inside the footprint and under the roof, but not on the facade, the roof or outside', () => {
    const b = square(10)
    expect(panelInside({ ...panel, x: 0, z: 0, elevation: 1 }, b)).toBe(true)
    expect(panelInside({ ...panel, x: 10.05, z: 0, elevation: 1 }, b)).toBe(false)
    expect(panelInside({ ...panel, x: 0, z: 0, elevation: 12 }, b)).toBe(false)
    expect(panelInside({ ...panel, x: 30, z: 0, elevation: 1 }, b)).toBe(false)
  })
})

describe('reference panel', () => {
  const area = panel.width * panel.height
  const ref = referenceEnergy(panel, MILAN.lat, MILAN.lon, 2025, DEFAULT_ASSUMPTIONS, climate.clearness)

  it('matches a traced 30 degree south panel with nothing in the way', () => {
    const open = buildBvh(Float32Array.from([1000, -50, 1000, 1001, -50, 1000, 1000, -50, 1001]))
    const south: Panel = { ...panel, tilt: 30, azimuth: 180, elevation: 5 }
    const traced = shadePanel(open, south, yearSlots(MILAN.lat, MILAN.lon, 2025))
    const e = panelEnergy(traced.irradiation, area, DEFAULT_ASSUMPTIONS, DAYS_IN_MONTH, climate.clearness)
    expect(ref.ideal).toBeCloseTo(e.ideal, 6)
    expect(ref.weather!).toBeCloseTo(e.weather!, 6)
  })

  it('is a plausible Milan figure, about 250 kWh a year per square metre of panel with weather', () => {
    expect(ref.weather! / area).toBeGreaterThan(180)
    expect(ref.weather! / area).toBeLessThan(300)
    expect(ref.shadingCost).toBe(0)
  })

  it('faces north in the southern hemisphere and does not depend on where the real panel is', () => {
    const north = referenceEnergy(panel, -33.9, 18.4, 2025, DEFAULT_ASSUMPTIONS)
    const moved = referenceEnergy({ ...panel, x: 99, elevation: 40, tilt: 10, azimuth: 0 }, -33.9, 18.4, 2025, DEFAULT_ASSUMPTIONS)
    expect(moved.ideal).toBeCloseTo(north.ideal, 6)
    expect(north.ideal / area).toBeGreaterThan(200)
  })

  it('words the line with local weather, or on a clear sky without it', () => {
    expect(referenceLine(ref, true, MILAN.lat)).toMatch(/^An unshaded panel of the same size, tilted 30° and facing south, would make about [\d,]+0 kWh a year here\.$/)
    expect(referenceLine(ref, false, -33.9)).toMatch(/facing north.*a year here on a clear sky\.$/)
  })
})
