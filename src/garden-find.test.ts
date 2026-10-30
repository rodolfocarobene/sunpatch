import { describe, expect, it } from 'vitest'
import { CELL_SIZE, bestSpot, compass, findDeadEnd, findSummary, monthCounts, kindStats, kindsFor, stepOf, surfaceY, type KindStats, type Scored } from './garden-find'
import { POT_HEIGHT, type GardenSpot, type SunnySpot } from './garden-spots'
import { plantById } from './plants'

const plant = (id: string) => plantById(id)!
const spot = (kind: 'indoor' | 'ground' | 'roof', x = 0, z = 0, minutes = 300): SunnySpot => ({ x, y: 1, z, indoor: kind === 'indoor', kind, sunMinutes: Array(12).fill(minutes) })
const good: Scored = { score: 1, rating: 'good' }
const ok: Scored = { score: 0.5, rating: 'ok' }
const poor: Scored = { score: 0, rating: 'poor' }

describe('colour steps', () => {
  it('maps ratings to three steps, poor uncoloured', () => {
    expect([stepOf('good'), stepOf('ok'), stepOf('poor')]).toEqual([2, 1, 0])
  })
  it('has a cell size for every kind of spot', () => {
    expect(CELL_SIZE).toEqual({ indoor: 0.5, ground: 2, roof: 1 })
  })
})

describe('kindsFor', () => {
  it('skips outdoor spots for an indoor-only plant, with a reason', () => {
    const r = kindsFor(plant('snake-plant'))
    expect(r.kinds).toEqual(['indoor'])
    expect(r.note).toMatch(/Snake plant is grown indoors/)
  })
  it('skips the floor for an outdoor-only plant, with a reason', () => {
    const r = kindsFor(plant('tomato'))
    expect(r.kinds).toEqual(['ground', 'roof'])
    expect(r.note).toMatch(/Tomato is grown outdoors/)
  })
  it('scores every kind for a plant that grows anywhere, without a note', () => {
    expect(kindsFor(plant('basil'))).toEqual({ kinds: ['indoor', 'ground', 'roof'] })
  })
})

describe('compass', () => {
  it('names the direction in scene metres (x east, z south)', () => {
    expect(compass(0, 10, 1)).toBe('south')
    expect(compass(0, -10, 1)).toBe('north')
    expect(compass(10, 0, 1)).toBe('east')
    expect(compass(-10, 0, 1)).toBe('west')
    expect(compass(7, 7, 1)).toBe('south-east')
    expect(compass(-7, -7, 1)).toBe('north-west')
  })
  it('says nothing for a spot near the centre', () => {
    expect(compass(1, 1, 4)).toBe('')
  })
})

describe('kindStats', () => {
  it('counts per kind over the scored spots only and takes the centre of the good ones', () => {
    const spots: GardenSpot[] = [spot('ground', 0, 10), spot('ground', 0, 20), spot('ground', 0, -30), spot('roof'), spot('indoor')]
    const stats = kindStats(spots, [good, good, poor, ok, undefined])
    expect(stats.map((s) => [s.kind, s.total, s.good, s.ok])).toEqual([['ground', 3, 2, 0], ['roof', 1, 0, 1]])
    expect(stats[0].centre).toEqual({ x: 0, z: 15 })
    expect(stats[1].centreOf).toBe('ok')
  })
})

describe('why nowhere is suitable', () => {
  const dark: Scored = { ...poor, why: 'dark' }
  const hot: Scored = { ...poor, why: 'hot' }
  it('names the reason most of the failing spots share', () => {
    const spots: GardenSpot[] = Array.from({ length: 5 }, () => spot('indoor'))
    expect(kindStats(spots, [dark, dark, dark, hot, poor])[0].why).toBe('dark')
  })
  it('names none when the reasons are mixed, missing, or the kind has a usable spot', () => {
    const spots: GardenSpot[] = Array.from({ length: 4 }, () => spot('indoor'))
    expect(kindStats(spots, [dark, dark, hot, hot])[0].why).toBeUndefined()
    expect(kindStats(spots, [poor, poor, poor, poor])[0].why).toBeUndefined()
    expect(kindStats(spots, [dark, dark, dark, ok])[0].why).toBeUndefined()
  })
})

describe('findSummary', () => {
  const centre = { x: 0, z: 0 }
  const stat = (kind: KindStats['kind'], good: number, ok: number, c?: { x: number; z: number }): KindStats => ({ kind, total: 50, good, ok, centre: c, centreOf: good > 0 ? 'good' : 'ok' })

  it('names the best kinds with a direction and the kinds with nowhere', () => {
    const text = findSummary('basil', null, [stat('indoor', 0, 0), stat('ground', 20, 5, { x: 0, z: 12 }), stat('roof', 8, 0, { x: 1, z: 1 })], centre)
    expect(text).toBe('Best spots for basil: the ground south of the building and the roof. Nowhere suitable indoors.')
  })
  it('gives the reason in brackets when it is clear', () => {
    const text = findSummary('basil', null, [{ ...stat('indoor', 0, 0), why: 'dark' }, stat('ground', 20, 0, { x: 0, z: 12 })], centre)
    expect(text).toBe('Best spots for basil: the ground south of the building. Nowhere suitable indoors (not enough direct sun).')
  })
  it('keeps a reason with its own kind when the others have none', () => {
    const text = findSummary('basil', 'April', [stat('indoor', 5, 0, { x: 0, z: -5 }), stat('ground', 0, 0), { ...stat('roof', 0, 0), why: 'frost' }], centre)
    expect(text).toBe('Best spots for basil in April: indoors, in the north of the apartment. Nowhere suitable on the ground. Nowhere suitable on the roof (frost).')
  })
  it('mentions the month', () => {
    expect(findSummary('basil', 'December', [stat('roof', 3, 0)], centre)).toBe('Best spots for basil in December: the roof.')
  })
  it('says the ok spots are only fair beside good ones', () => {
    const text = findSummary('mint', null, [stat('ground', 4, 0, { x: -12, z: 0 }), stat('indoor', 0, 9, { x: 0, z: -5 })], centre)
    expect(text).toBe('Best spots for mint: the ground west of the building. Only fair: indoors, in the north of the apartment.')
  })
  it('falls back to the best of the ok spots, or to no spot at all', () => {
    expect(findSummary('fern', null, [stat('indoor', 0, 4, { x: 0, z: 0 })], centre)).toBe('No spot is ideal for fern; the best are indoors.')
    expect(findSummary('fern', 'July', [stat('indoor', 0, 0), stat('roof', 0, 0)], centre)).toBe('Fern finds no suitable spot in July.')
  })
  it('is empty when nothing was scored', () => {
    expect(findSummary('basil', null, [], centre)).toBe('')
  })
  it('calls spots all around the building when their centre is near it', () => {
    expect(findSummary('basil', null, [stat('ground', 30, 0, { x: 0.5, z: -1 })], centre)).toContain('the ground around the building')
  })
})

describe('bestSpot', () => {
  it('takes the highest score, then the most sun in the month', () => {
    const spots = [spot('ground', 0, 0, 100), spot('ground', 1, 0, 400), spot('roof', 2, 0, 300), spot('indoor', 3, 0, 900)]
    expect(bestSpot(spots, [good, good, ok, poor], null)).toBe(1)
    spots[0].sunMinutes[5] = 500
    expect(bestSpot(spots, [good, good, ok, poor], 5)).toBe(0)
  })
  it('ignores unscored and poor spots, and says so when none is left', () => {
    expect(bestSpot([spot('ground'), spot('roof')], [poor, undefined], null)).toBeUndefined()
    expect(bestSpot([], [], null)).toBeUndefined()
  })
  it('gives the surface height a click there would report', () => {
    expect(surfaceY(spot('ground'))).toBeCloseTo(1 - POT_HEIGHT)
  })
})

describe('findDeadEnd', () => {
  const basil = plant('basil')
  const climate = { tMean: Array(12).fill(20), tMin: Array(12).fill(14), tMax: Array(12).fill(26), tLow: Array(12).fill(12) }
  const sunny = (minutes: number[]): SunnySpot => ({ x: 0, y: 1, z: 0, indoor: false, kind: 'ground', sunMinutes: minutes })

  it('names the months that work and switches to the one with most good spots', () => {
    const spots = [sunny([0, 0, 0, 0, 500, 500, 500, 500, 0, 0, 0, 0]), sunny([0, 0, 0, 0, 0, 500, 500, 0, 0, 0, 0, 0])]
    const out = findDeadEnd(basil, 11, monthCounts(basil, spots, climate), spots)!
    expect(out.text).toBe('Basil does well here in May to Aug.')
    expect(out.switchMonth).toBe(5)
  })

  it('does not point back to the month already chosen', () => {
    const spots = [sunny([0, 0, 0, 0, 500, 0, 0, 0, 0, 0, 0, 0])]
    expect(findDeadEnd(basil, 4, monthCounts(basil, spots, climate), spots)).toBeUndefined()
  })

  it('gives the sunniest spot against the need when no month works', () => {
    const spots = [sunny([0, 0, 0, 0, 0, 0, 120, 0, 0, 0, 0, 0]), sunny(Array(12).fill(30))]
    const out = findDeadEnd(basil, null, monthCounts(basil, spots, climate), spots, 'dark')!
    expect(out.text).toBe(`Nowhere suitable all year; the sunniest spot gets 2 h in July, basil needs ${basil.sun.min} h.`)
    expect(out.switchMonth).toBeUndefined()
  })

  it('names the shared reason when it is not the sun', () => {
    const spots = [sunny(Array(12).fill(600))]
    const cold = { ...climate, tMean: Array(12).fill(-5), tMin: Array(12).fill(-9), tMax: Array(12).fill(-1), tLow: Array(12).fill(-12) }
    expect(findDeadEnd(basil, null, monthCounts(basil, spots, cold), spots, 'frost')!.text).toBe('Nowhere suitable all year (frost).')
  })
})
