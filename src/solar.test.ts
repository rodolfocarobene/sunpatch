import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { BoxGeometry, Mesh } from 'three'
import type { Panel } from './plan'
import { DAYS_IN_MONTH, shadePanel, yearSlots } from './panel-shade'
import { buildBvh, collectOccluders } from './sunmap-trace'
import { sunDirection } from './sun'
import { airMass, clearSky, DEFAULT_ASSUMPTIONS, panelEnergy } from './solar'
import { clearClimateMemory, climateKey, loadClimate, parseClimate } from './weather'

const MILAN = { lat: 45.4627, lon: 9.191 }
const fixture = JSON.parse(readFileSync(new URL('../fixtures/nasa-power-milan.json', import.meta.url), 'utf8'))
const climate = parseClimate(fixture)
const slots = yearSlots(MILAN.lat, MILAN.lon, 2025)
const open = buildBvh(Float32Array.from([1000, -50, 1000, 1001, -50, 1000, 1000, -50, 1001]))
const base: Panel = { id: 'p', x: 0, z: 0, elevation: 5, width: 1.13, height: 1.72, tilt: 35, azimuth: 180 }
const area = base.width * base.height

const energyOf = (p: Panel, bvh = open, withClimate = true) =>
  panelEnergy(shadePanel(bvh, p, slots).irradiation, area, DEFAULT_ASSUMPTIONS, DAYS_IN_MONTH, withClimate ? climate.clearness : undefined)

describe('clear sky', () => {
  it('has Kasten-Young air mass of about 1 at the zenith and 38 at the horizon', () => {
    expect(airMass(90)).toBeCloseTo(1, 2)
    expect(airMass(0)).toBeGreaterThan(35)
  })

  it('gives plausible DNI and GHI at noon in Milan in June', () => {
    const noon = sunDirection(new Date(Date.UTC(2025, 5, 21, 10, 30)), MILAN.lat, MILAN.lon)
    const sky = clearSky(noon.altitudeDeg)
    expect(noon.altitudeDeg).toBeGreaterThan(65)
    expect(sky.dni).toBeGreaterThan(850)
    expect(sky.dni).toBeLessThan(1000)
    expect(sky.ghi).toBeGreaterThan(850)
    expect(sky.ghi).toBeLessThan(1000)
  })

  it('stays near the NASA POWER clear-sky daily irradiation on the horizontal', () => {
    const day = new Array<number>(12).fill(0)
    for (let i = 0; i < slots.month.length; i++) day[slots.month[i]] += (clearSky((Math.asin(slots.dirs[i * 3 + 1]) * 180) / Math.PI).ghi * 0.25) / 1000
    const nasa = Object.values<number>(fixture.properties.parameter.CLRSKY_SFC_SW_DWN)
    for (const m of [0, 5, 11]) expect(day[m] / nasa[m]).toBeGreaterThan(0.75)
    expect(day[5] / nasa[5]).toBeLessThan(1.2)
  })

  it('is dark below the horizon', () => {
    expect(clearSky(-5).ghi).toBe(0)
  })
})

describe('panel energy', () => {
  const south = energyOf(base)
  const perKwp = (e: number) => e / south.kwp

  it('puts a south 35 degree panel in the usual range for Milan', () => {
    console.info(`Milan 35 deg south: ${perKwp(south.ideal).toFixed(0)} ideal, ${perKwp(south.weather!).toFixed(0)} weather kWh/kWp/yr (${south.kwp.toFixed(2)} kWp)`)
    expect(south.kwp).toBeCloseTo(0.41, 2)
    expect(perKwp(south.ideal)).toBeGreaterThan(1500)
    expect(perKwp(south.ideal)).toBeLessThan(1900)
    expect(perKwp(south.weather!)).toBeGreaterThan(1100)
    expect(perKwp(south.weather!)).toBeLessThan(1450)
  })

  it('gives a vertical south-west panel less than the south one', () => {
    const wall = energyOf({ ...base, tilt: 90, azimuth: 225 })
    expect(wall.ideal).toBeLessThan(south.ideal)
    expect(wall.ideal).toBeGreaterThan(0)
  })

  it('costs nothing in shade terms when nothing is in the way', () => {
    expect(south.shadingCost).toBeCloseTo(0, 6)
    expect(south.idealOpen).toBeCloseTo(south.ideal, 6)
  })

  it('loses energy to a shading box', () => {
    const mesh = new Mesh(new BoxGeometry(12, 12, 1))
    mesh.position.set(0, 8, 3) // a wall south of the panel, in the sun's way
    mesh.castShadow = true
    const shaded = energyOf(base, buildBvh(collectOccluders([mesh])))
    expect(shaded.ideal).toBeLessThan(south.ideal)
    expect(shaded.shadingCost).toBeGreaterThan(0)
    expect(shaded.shadingShare).toBeGreaterThan(0)
    expect(shaded.idealOpen).toBeCloseTo(south.idealOpen, 6)
  })

  it('falls back to the ideal figure without climate data', () => {
    const e = energyOf(base, open, false)
    expect(e.weather).toBeUndefined()
    expect(e.monthWeather).toBeUndefined()
    expect(e.ideal).toBeGreaterThan(0)
  })

  it('scales with efficiency', () => {
    const half = panelEnergy(shadePanel(open, base, slots).irradiation, area, { efficiency: 0.105, losses: 0.14 }, DAYS_IN_MONTH)
    expect(half.ideal).toBeCloseTo(south.ideal / 2, 6)
  })
})

describe('NASA POWER', () => {
  it('parses the fixture into a monthly clear-sky index', () => {
    expect(climate.clearness).toHaveLength(12)
    expect(climate.clearness[6]).toBeCloseTo(6.5736 / 7.6344, 4) // July about 0.86
    expect(climate.clearness[10]).toBeCloseTo(1.4702 / 2.3542, 4) // November about 0.62
  })

  it('rejects a response with a missing month', () => {
    expect(() => parseClimate({})).toThrow()
    expect(() => parseClimate({ properties: { parameter: { ALLSKY_SFC_SW_DWN: { JAN: -999 }, CLRSKY_SFC_SW_DWN: { JAN: 2 } } } })).toThrow()
  })

  it('rounds the place to 0.1 degrees', () => {
    expect(climateKey(45.4627, 9.191)).toEqual({ lat: 45.5, lon: 9.2, key: '45.5,9.2' })
  })

  it('fetches once per place and serves the second call from memory', async () => {
    clearClimateMemory()
    let calls = 0
    const fetcher = (async () => {
      calls++
      return { ok: true, status: 200, json: async () => fixture }
    }) as unknown as typeof fetch
    const [a, b] = await Promise.all([loadClimate(45.46, 9.19, fetcher), loadClimate(45.47, 9.19, fetcher)])
    await loadClimate(45.46, 9.19, fetcher)
    expect(calls).toBe(1)
    expect(a.clearness).toEqual(b.clearness)
  })

  it('rejects on a failed request', async () => {
    clearClimateMemory()
    const fetcher = (async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch
    await expect(loadClimate(10, 10, fetcher)).rejects.toThrow()
  })
})
