import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/nasa-power-milan.json'
import { assess, explain, INDOOR_TEMP, rankPlants, rateMonth, scoreSpots, type Spot } from './garden'
import { PLANTS, plantById, sunClass } from './plants'
import { parseClimate } from './weather'

const milan = parseClimate(fixture)
const plant = (id: string) => plantById(id)!
const monthsOf = (id: string, spot: Spot) => assess(plant(id), spot, milan).summary.months.flatMap((ok, m) => (ok ? [m] : []))

const southBalcony: Spot = { indoor: false, sunMinutes: [120, 150, 240, 330, 420, 490, 500, 450, 380, 230, 150, 110] }
const northRoom: Spot = { indoor: true, sunMinutes: [0, 0, 0, 5, 10, 30, 30, 15, 0, 0, 0, 0] }
const brightOutdoor: Spot = { indoor: false, sunMinutes: Array(12).fill(600) }
const sunnyWindow: Spot = { indoor: true, sunMinutes: [180, 240, 300, 360, 420, 480, 480, 420, 360, 270, 200, 160] }

describe('plant catalogue', () => {
  it('has about 30 plants with unique ids', () => {
    expect(PLANTS.length).toBeGreaterThanOrEqual(28)
    expect(new Set(PLANTS.map((p) => p.id)).size).toBe(PLANTS.length)
  })

  it.each(PLANTS.map((p) => [p.id, p] as const))('%s has consistent ranges', (_, p) => {
    expect(p.indoor || p.outdoor).toBe(true)
    expect(p.sun.min).toBeGreaterThanOrEqual(0)
    expect(p.sun.min).toBeLessThanOrEqual(p.sun.ideal)
    if (p.sun.max !== undefined) expect(p.sun.max).toBeGreaterThanOrEqual(p.sun.ideal)
    expect(p.sun.ideal).toBeLessThanOrEqual(12)
    const t = p.temp
    expect(t.survive).toBeLessThanOrEqual(t.min)
    expect(t.min).toBeLessThanOrEqual(t.optLow)
    expect(t.optLow).toBeLessThanOrEqual(t.optHigh)
    expect(t.optHigh).toBeLessThanOrEqual(t.max)
    expect(p.source.length).toBeGreaterThan(0)
    if (p.life === 'annual') expect(p.days).toBeGreaterThan(0)
    else expect(p.days).toBeUndefined()
  })

  it('uses the conventional sun classes', () => {
    expect(sunClass(plant('tomato'))).toBe('full sun')
    expect(sunClass(plant('lettuce'))).toBe('part sun')
    expect(sunClass(plant('mint'))).toBe('part sun')
    expect(sunClass(plant('pothos'))).toBe('shade')
  })
})

describe('scoring in Milan', () => {
  it('grows basil outdoors on a south balcony only in summer', () => {
    expect(monthsOf('basil', southBalcony)).toEqual([4, 5, 6, 7, 8])
    const s = assess(plant('basil'), southBalcony, milan).summary
    expect(s.allYear).toBe(false)
    expect(s.fits).toBe(true)
    expect(s.sowMonth).toBe(4)
  })

  it('grows lettuce in spring and autumn but not in summer heat or winter', () => {
    const ms = monthsOf('lettuce', southBalcony)
    expect(ms).toEqual(expect.arrayContaining([2, 3, 4, 8, 9]))
    expect(ms).not.toContain(6)
    expect(ms).not.toContain(0)
    expect(assess(plant('lettuce'), southBalcony, milan).summary.sowMonth).toBe(2)
  })

  it('keeps a snake plant and a pothos alive in a dark north room all year', () => {
    for (const id of ['snake-plant', 'pothos', 'fern']) expect(assess(plant(id), northRoom, milan).summary.allYear).toBe(true)
    expect(assess(plant('basil'), northRoom, milan).summary.months.some(Boolean)).toBe(false)
  })

  it('ignores the weather indoors and the clouds of winter', () => {
    const r = rateMonth(plant('basil'), sunnyWindow, milan, 6)
    expect(r.tMean).toBe((INDOOR_TEMP.min + INDOOR_TEMP.max) / 2)
    expect(r.issues.some((i) => i.kind === 'frost' || i.kind === 'cold')).toBe(false)
    expect(assess(plant('basil'), sunnyWindow, milan).summary.months.filter(Boolean).length).toBe(6)
  })

  it('flags scorch for shade plants in strong sun', () => {
    const r = rateMonth(plant('fern'), { indoor: true, sunMinutes: Array(12).fill(300) }, milan, 5)
    expect(r.rating).toBe('poor')
    expect(r.issues).toContainEqual({ kind: 'glare', severe: true })
  })

  it('rejects an outdoor-only crop indoors and a houseplant outdoors', () => {
    expect(rateMonth(plant('tomato'), sunnyWindow, milan, 6).issues).toContainEqual({ kind: 'place', severe: true })
    expect(rateMonth(plant('snake-plant'), southBalcony, milan, 6).rating).toBe('poor')
  })

  it('treats frost differently for tender and hardy plants', () => {
    expect(rateMonth(plant('tomato'), brightOutdoor, milan, 3).issues).toContainEqual({ kind: 'frost', severe: true })
    expect(rateMonth(plant('chives'), southBalcony, milan, 1).issues.some((i) => i.kind === 'frost')).toBe(false)
  })

  it('lets a hardy perennial rest through a cold winter but not a tender one', () => {
    const jan = rateMonth(plant('chives'), southBalcony, milan, 0)
    expect(jan.rating).toBe('ok')
    expect(explain(plant('chives'), jan)).toMatch(/^Resting in January/)
    expect(assess(plant('mint'), southBalcony, milan).summary.allYear).toBe(true)
    expect(rateMonth(plant('geranium'), southBalcony, milan, 0).rating).toBe('poor')
  })

  it('does not fit a long crop into a short window', () => {
    const slow = { ...plant('pepper'), days: 200 }
    const s = assess(slow, brightOutdoor, milan).summary
    expect(s.runMonths).toBe(5)
    expect(s.fits).toBe(false)
    expect(s.sowMonth).toBeUndefined()
  })
})

describe('ranking', () => {
  it('ranks plants for a spot best first and can keep the all-year ones', () => {
    const ranked = rankPlants(northRoom, milan)
    expect(ranked).toHaveLength(PLANTS.length)
    for (let i = 1; i < ranked.length; i++) expect(ranked[i - 1].score).toBeGreaterThanOrEqual(ranked[i].score)
    const all = rankPlants(northRoom, milan, { allYear: true }).map((r) => r.plant.id)
    expect(all).toEqual(expect.arrayContaining(['snake-plant', 'pothos']))
    expect(all).not.toContain('basil')
  })

  it('ranks for a chosen month', () => {
    const july = rankPlants(southBalcony, milan, { month: 6 })
    expect(july[0].rating).toBe('good')
    expect(july.find((r) => r.plant.id === 'basil')!.rating).toBe('good')
    expect(july.find((r) => r.plant.id === 'lettuce')!.rating).toBe('poor')
  })

  it('scores one plant over many spots', () => {
    const out = scoreSpots(plant('basil'), [southBalcony, northRoom, sunnyWindow], milan, 6)
    expect(out.map((o) => o.rating)).toEqual(['good', 'poor', 'good'])
    expect(out[0].score).toBeGreaterThan(out[1].score)
  })
})

describe('explanations', () => {
  it('says why in one sentence', () => {
    const dec = rateMonth(plant('basil'), { indoor: true, sunMinutes: Array(12).fill(40) }, milan, 11)
    expect(explain(plant('basil'), dec)).toBe('Too dark in December: 40 min of direct sun, basil needs 6 h.')
    expect(explain(plant('lettuce'), rateMonth(plant('lettuce'), southBalcony, milan, 6))).toMatch(/^Too hot in July: days reach 29 C/)
    expect(explain(plant('tomato'), rateMonth(plant('tomato'), brightOutdoor, milan, 3))).toMatch(/^Frost in April/)
    expect(explain(plant('basil'), rateMonth(plant('basil'), southBalcony, milan, 6))).toMatch(/^Good in July: 8.3 h of direct sun/)
  })

  it('explains every month of every plant with a sentence', () => {
    for (const p of PLANTS)
      for (const spot of [southBalcony, northRoom])
        for (let m = 0; m < 12; m++) expect(explain(p, rateMonth(p, spot, milan, m))).toMatch(/\.$/)
  })
})
