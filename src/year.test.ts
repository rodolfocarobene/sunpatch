import { afterEach, describe, expect, it } from 'vitest'
import { useLang } from './i18n'
import { barFractions, extremeMonth, monthRuns, yearDays, yearSummary } from './year'

afterEach(() => useLang('en'))

const milan = [190, 230, 290, 340, 400, 430, 420, 370, 310, 250, 200, 195]

describe('yearDays', () => {
  it('is the 21st of each month, January to December', () => {
    const days = yearDays(2026)
    expect(days).toHaveLength(12)
    expect(days.map((d) => d.getMonth())).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    expect(days.every((d) => d.getDate() === 21 && d.getFullYear() === 2026)).toBe(true)
  })
})

describe('barFractions', () => {
  it('scales to the largest month', () => {
    expect(barFractions([0, 50, 100])).toEqual([0, 0.5, 1])
  })
  it('keeps every bar at zero when nothing has sun', () => {
    expect(barFractions([0, 0, 0])).toEqual([0, 0, 0])
  })
})

describe('extremeMonth', () => {
  it('finds the first most and least month', () => {
    expect(extremeMonth([5, 9, 9, 2, 2], true)).toBe(1)
    expect(extremeMonth([5, 9, 9, 2, 2], false)).toBe(3)
  })
})

describe('monthRuns', () => {
  it('joins a run across the new year', () => {
    const has = Array.from({ length: 12 }, (_, m) => m >= 10 || m === 0)
    expect(monthRuns(has)).toEqual([[10, 0]])
  })
  it('lists separate runs in calendar order', () => {
    const has = Array.from({ length: 12 }, (_, m) => m === 2 || m === 3 || m === 8)
    expect(monthRuns(has)).toEqual([[2, 3], [8, 8]])
  })
  it('treats all true as one run', () => {
    expect(monthRuns(Array(12).fill(true))).toEqual([[0, 11]])
  })
})

describe('yearSummary', () => {
  it('names the best and worst month', () => {
    expect(yearSummary(milan)).toBe('Most sun in June (7 h 10 min), least in January (3 h 10 min)')
  })
  it('says which months get no sun, across the new year', () => {
    const m = [0, 100, 200, 300, 400, 500, 450, 350, 250, 150, 0, 0]
    expect(yearSummary(m)).toBe('Most sun in June (8 h 20 min). No direct sun from November to January')
  })
  it('says it for a single month', () => {
    const m = milan.slice()
    m[11] = 0
    expect(yearSummary(m)).toBe('Most sun in June (7 h 10 min). No direct sun in December')
  })
  it('says so when no month has sun', () => {
    expect(yearSummary(Array(12).fill(0))).toBe('No direct sun inside in any month')
  })
  it('is in Italian too', () => {
    useLang('it')
    const m = [0, 100, 200, 300, 400, 500, 450, 350, 250, 150, 0, 0]
    expect(yearSummary(m)).toBe('Più sole a giugno (8 h 20 min). Nessun sole diretto da novembre a gennaio')
    expect(yearSummary(milan)).toBe('Più sole a giugno (7 h 10 min), meno a gennaio (3 h 10 min)')
  })
})
