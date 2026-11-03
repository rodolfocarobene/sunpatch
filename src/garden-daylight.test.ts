import { afterEach, describe, expect, it } from 'vitest'
import fixture from '../fixtures/nasa-power-milan.json'
import { assess, explain, rankPlants, rateMonth, scoreSpots, type Spot } from './garden'
import { plantRow, ratingLabel } from './garden-text'
import { plantFacts } from './plant-card'
import { useLang } from './i18n'
import { indoorPoints, meanDaylight, withSun, type GardenSpot } from './garden-spots'
import { PLANTS, plantById } from './plants'
import { parseClimate } from './weather'

const milan = parseClimate(fixture)
const plant = (id: string) => plantById(id)!
const dark = Array(12).fill(0)
const indoor = (daylight: number | undefined, sunMinutes = dark): Spot => ({ indoor: true, sunMinutes, daylight })

afterEach(() => useLang('en'))

describe('daylight need of the catalogue', () => {
  it('is on every houseplant that lives on indirect light, and on nothing outdoor-only', () => {
    for (const p of PLANTS) {
      if (p.kind === 'houseplant' && p.sun.ideal <= 2) expect(p.daylight, p.id).toBeDefined()
      if (!p.indoor) expect(p.daylight, p.id).toBeUndefined()
      if (p.daylight) {
        expect(p.daylight.min, p.id).toBeGreaterThan(0)
        expect(p.daylight.min, p.id).toBeLessThanOrEqual(p.daylight.ideal)
        expect(p.daylight.ideal, p.id).toBeLessThanOrEqual(5) // above 5 % is "very bright": that is a direct-sun plant
      }
    }
  })

  it('leaves the direct-sun plants (succulents, herbs, vegetables) without one, so daylight alone never makes them good', () => {
    for (const id of ['aloe', 'jade-plant', 'basil', 'rosemary', 'pepper', 'tomato']) expect(plant(id).daylight, id).toBeUndefined()
    expect(assess(plant('aloe'), indoor(8), milan).rating).toBe('poor')
  })
})

describe('light verdict at an indoor spot', () => {
  const pothos = plant('pothos') // daylight 0.5 / 2
  const light = (df: number | undefined, sunMinutes = dark) => rateMonth(pothos, indoor(df, sunMinutes), milan, 5)

  it('is good from the ideal daylight, ok from the minimum, poor below', () => {
    expect(light(2).rating).toBe('good')
    expect(light(3.2).rating).toBe('good')
    expect(light(1.9).rating).toBe('ok')
    expect(light(0.5).rating).toBe('ok')
    expect(light(0.4).rating).toBe('poor')
  })

  it('takes the better of direct sun and daylight', () => {
    const sunny = Array(12).fill(120) // 2 h of sun: good on sun alone
    expect(light(0.1, sunny).rating).toBe('good')
    expect(light(0.1, sunny).daylight?.carries).toBe(false)
    expect(light(3, sunny).rating).toBe('good')
    expect(light(3).daylight?.carries).toBe(true)
  })

  it('rates as before without a measured daylight (ok, short of sun)', () => {
    const r = light(undefined)
    expect(r.rating).toBe('ok')
    expect(r.daylight).toBeUndefined()
  })

  it('does not count a glint of sun as a verdict once daylight is known', () => {
    expect(light(0.2, Array(12).fill(5)).rating).toBe('poor')
  })

  it('ignores daylight outdoors', () => {
    const out: Spot = { indoor: false, sunMinutes: dark, daylight: 100 }
    expect(rateMonth(plant('tomato'), out, milan, 5).daylight).toBeUndefined()
    expect(rateMonth(plant('fern'), out, milan, 5).issues.some((i) => i.kind === 'place')).toBe(true)
    expect(rateMonth(plant('basil'), out, milan, 5).issues.some((i) => i.kind === 'dark' && i.severe)).toBe(true)
  })

  it('still applies glare', () => {
    expect(light(5).issues).toEqual([])
    const scorch = rateMonth(pothos, indoor(5, Array(12).fill(300)), milan, 5) // 5 h of sun, max 3
    expect(scorch.issues.some((i) => i.kind === 'glare')).toBe(true)
  })
})

describe('pill and sentences', () => {
  it('says "Low light" only for an OK held back by light, and plain Good or Poor otherwise', () => {
    expect(ratingLabel(assess(plant('pothos'), indoor(1), milan), null)).toBe('Low light')
    const rGood = assess(plant('pothos'), indoor(3), milan)
    expect(rGood.rating).toBe('good')
    expect(ratingLabel(rGood, null)).toBe('Good')
    expect(ratingLabel(assess(plant('pothos'), indoor(0.1), milan), null)).toBe('Poor')
  })

  it('names the daylight that carried it, in English', () => {
    expect(explain(plant('pothos'), rateMonth(plant('pothos'), indoor(3.2), milan, 5))).toBe(
      'Good in June: bright indirect light here (3.2 % daylight, estimate), enough for pothos.',
    )
    expect(explain(plant('pothos'), rateMonth(plant('pothos'), indoor(1.2), milan, 5))).toBe(
      'Workable in June, but short of light: fair indirect light here (1.2 % daylight, estimate), pothos does best with 2 %.',
    )
    expect(explain(plant('pothos'), rateMonth(plant('pothos'), indoor(0.2), milan, 5))).toBe(
      'Too dark in June: 0 min of direct sun and dim indirect light (0.2 % daylight, estimate), pothos needs 0.5 %.',
    )
  })

  it('names the daylight that carried it, in Italian', () => {
    useLang('it')
    expect(explain(plant('pothos'), rateMonth(plant('pothos'), indoor(3.2), milan, 5))).toBe('A giugno: luce indiretta luminosa qui (3,2 % di luce diurna, stima), le basta.')
    expect(explain(plant('pothos'), rateMonth(plant('pothos'), indoor(0.2), milan, 5))).toMatch(/^Troppo buio in giugno: .* luce indiretta scarsa \(0,2 % di luce diurna, stima\)/)
  })

  it('keeps the sun sentence when direct sun carried it', () => {
    const sunny = Array(12).fill(120)
    expect(explain(plant('pothos'), rateMonth(plant('pothos'), indoor(0.1, sunny), milan, 5))).toContain('of direct sun and')
    expect(plantRow(assess(plant('pothos'), indoor(1), milan), 5).reason).toContain('indirect light')
  })
})

describe('ranking and maps', () => {
  const houseplants = PLANTS.filter((p) => p.kind === 'houseplant')

  it('lifts shade plants near the window and drops them deep in the room', () => {
    const near = rankPlants(indoor(4), milan, { plants: houseplants })
    const deep = rankPlants(indoor(0.3), milan, { plants: houseplants })
    expect(near.find((r) => r.plant.id === 'pothos')!.rating).toBe('good')
    expect(deep.find((r) => r.plant.id === 'pothos')!.rating).toBe('poor')
    expect(near.find((r) => r.plant.id === 'aloe')!.rating).toBe('poor')
  })

  it('scoreSpots uses each indoor spot daylight, and outdoor spots ignore it', () => {
    const spots: Spot[] = [indoor(4), indoor(1), indoor(0.1), { indoor: false, sunMinutes: dark, daylight: 4 }]
    expect(scoreSpots(plant('pothos'), spots, milan, 5).map((x) => x.rating)).toEqual(['good', 'ok', 'poor', 'poor'])
  })
})

describe('plant card fact', () => {
  it('shows the daylight need next to the direct sun line, and only for plants that have one', () => {
    const facts = plantFacts(plant('pothos'))
    const i = facts.findIndex((f) => f.label === 'Indirect light')
    expect(i).toBeGreaterThan(facts.findIndex((f) => f.label === 'Direct sun'))
    expect(facts[i].value).toBe('Indoors: at least 0.5 %, best 2 % (daylight factor, rough)')
    expect(plantFacts(plant('tomato')).some((f) => f.label === 'Indirect light')).toBe(false)
    useLang('it')
    expect(plantFacts(plant('monstera')).find((f) => f.label === 'Luce indiretta')?.value).toBe('In casa: almeno 1,5 %, meglio 3 % (fattore di luce diurna, indicativo)')
  })
})

describe('daylight on spots', () => {
  const at = (x: number, indoor: boolean): GardenSpot => ({ x, y: 1.4, z: 2, indoor, kind: indoor ? 'indoor' : 'ground' })
  const spots = [at(0, false), at(1, true), at(2, true)]

  it('hands the daylight values to the indoor spots only, in order', () => {
    const out = withSun(spots, new Float32Array(36), [3, 1])
    expect(out.map((s) => s.daylight)).toEqual([undefined, 3, 1])
    expect(withSun(spots, new Float32Array(36)).every((s) => s.daylight === undefined)).toBe(true)
  })

  it('lists the indoor floor points and their floor height', () => {
    const { points, floorY } = indoorPoints(spots)
    expect(Array.from(points)).toEqual([1, 2, 2, 2])
    expect(floorY).toBeCloseTo(1)
  })

  it('averages a disc, and has none when nothing was measured', () => {
    expect(meanDaylight(withSun(spots, new Float32Array(36), [3, 1]))).toBe(2)
    expect(meanDaylight(withSun(spots, new Float32Array(36)))).toBeUndefined()
  })
})
