import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/nasa-power-milan.json'
import { assess } from './garden'
import { hoursText, INDOOR_NOTE, monthsText, plantRow, reasonText, representativeMonth, splitPlants, sunStrip, tempStrip, WHERE } from './garden-text'
import { plantById } from './plants'
import { parseClimate } from './weather'

const milan = parseClimate(fixture)
const sunnyWindow = { indoor: true, sunMinutes: [180, 240, 300, 360, 420, 480, 480, 420, 360, 270, 200, 160] }

describe('spot card text', () => {
  it('says where the spot is and what indoors assumes', () => {
    expect(WHERE.indoor).toBe('Indoors, on the floor')
    expect(WHERE.ground).toBe('Outdoors, on the ground')
    expect(INDOOR_NOTE).toBe('Assumes a heated home, 18-24 °C.')
  })

  it('writes hours, or minutes under one hour', () => {
    expect(hoursText(40)).toBe('40 min')
    expect(hoursText(90)).toBe('1.5 h')
    expect(hoursText(420)).toBe('7 h')
  })

  it('scales the sun strip to its tallest month, but not below one hour', () => {
    const strip = sunStrip([0, 60, 120, 240, 480, 0, 0, 0, 0, 0, 0, 0])
    expect(strip[4].share).toBe(1)
    expect(strip[3].share).toBe(0.5)
    expect(strip[0].text).toBe('January: 0 min of direct sun a day')
    expect(sunStrip(Array(12).fill(30))[0].share).toBe(0.5)
  })

  it('places typical lows and highs on one scale and marks freezing', () => {
    const t = tempStrip(milan)
    expect(t.cells).toHaveLength(12)
    expect(Math.min(...t.cells.map((c) => c.lowShare))).toBe(0)
    expect(Math.max(...t.cells.map((c) => c.highShare))).toBe(1)
    expect(t.cells.every((c) => c.lowShare < c.highShare)).toBe(true)
    const winter = tempStrip({ tMin: [-3, 0, 4, 8, 12, 16, 18, 17, 13, 8, 3, 1], tMax: Array(12).fill(20) })
    expect(winter.cells.map((c) => c.cold)).toEqual([true, true, false, false, false, false, false, false, false, false, false, true])
    expect(tempStrip({ tMin: Array(12).fill(5), tMax: Array(12).fill(15) }).zeroShare).toBeNull()
    expect(tempStrip({ tMin: Array(12).fill(-10), tMax: Array(12).fill(10) }).zeroShare).toBe(0.5)
  })

  it('names growing months as runs, wrapping the year', () => {
    const flags = (on: number[]) => Array.from({ length: 12 }, (_, m) => on.includes(m))
    expect(monthsText(Array(12).fill(true))).toBe('all year')
    expect(monthsText(Array(12).fill(false))).toBe('no month')
    expect(monthsText(flags([2, 3, 4, 5, 6, 7, 8, 9]))).toBe('Mar to Oct')
    expect(monthsText(flags([10, 11, 0, 1, 2]))).toBe('Nov to Mar')
    expect(monthsText(flags([0, 1, 5, 8]))).toBe('Jan and Feb, Jun, Sep')
  })

  it('makes a row with the months, the sow month for an annual and one reason', () => {
    const lettuce = assess(plantById('lettuce')!, sunnyWindow, milan)
    const row = plantRow(lettuce, null)
    expect(row.name).toBe('Lettuce')
    expect(row.kind).toBe('vegetable')
    expect(row.growing).toMatch(/^Grows .*Sow in /)
    expect(row.reason.length).toBeGreaterThan(10)
  })

  it('explains the chosen month', () => {
    const basil = assess(plantById('basil')!, sunnyWindow, milan, 11)
    expect(reasonText(basil, 11)).toContain('December')
  })

  it('speaks for a whole year by a month the plant grows in, never one it cannot', () => {
    const outdoors = { indoor: false, sunMinutes: [0, 60, 180, 300, 420, 600, 630, 600, 420, 240, 60, 0] }
    const basil = assess(plantById('basil')!, outdoors, milan)
    expect(basil.rating).not.toBe('poor')
    expect(basil.summary.months[representativeMonth(basil)]).toBe(true)
    expect(reasonText(basil, null)).not.toContain('January')
    // The sunniest of its good months stands for a good plant.
    if (basil.rating === 'good') expect(basil.year[representativeMonth(basil)].rating).toBe('good')
  })

  it('speaks for a poor plant by its hardest month', () => {
    const dark = { indoor: true, sunMinutes: Array(12).fill(0) }
    const tomato = assess(plantById('tomato')!, dark, milan)
    expect(tomato.rating).toBe('poor')
    expect(reasonText(tomato, null).length).toBeGreaterThan(10)
  })

  it('keeps poor plants apart for "Why not others?"', () => {
    const dark = { indoor: true, sunMinutes: Array(12).fill(0) }
    const results = ['tomato', 'basil', 'lettuce'].map((id) => assess(plantById(id)!, dark, milan))
    const { fit, poor } = splitPlants(results)
    expect(fit.every((r) => r.rating !== 'poor')).toBe(true)
    expect(poor.every((r) => r.rating === 'poor')).toBe(true)
    expect(fit.length + poor.length).toBe(3)
    expect(poor.length).toBeGreaterThan(0)
  })
})
