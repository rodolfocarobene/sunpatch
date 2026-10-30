import { afterEach, describe, expect, it } from 'vitest'
import { dayHeadline, headlineText, rangeText } from './headline'
import { useLang } from './i18n'

afterEach(() => useLang('en'))

/** `rows[s][i]` lit flags of sample s in slot i; slots start at `from` every 5 minutes. */
function result(rows: number[][], from = 8 * 60) {
  const n = rows[0].length
  return { grid: { count: rows.length }, starts: Array.from({ length: n }, (_, i) => from + i * 5), lit: Uint8Array.from(rows.flat()) }
}
const slots = (from: number, to: number, total: number) => Array.from({ length: total }, (_, i) => (i >= from && i < to ? 1 : 0))
const day = new Date(2026, 11, 21)

describe('dayHeadline', () => {
  it('merges slots and samples into one stretch, with the total', () => {
    // 08:00 + 5 min per slot; slots 32..76 are 10:40..14:20
    const h = dayHeadline(result([slots(32, 60, 100), slots(40, 76, 100)]))
    expect(h.shown).toEqual([{ from: 640, to: 860 }])
    expect(h.minutes).toBe(220)
    expect(h.more).toBe(false)
  })
  it('reports no sun', () => {
    const h = dayHeadline(result([slots(0, 0, 20)]))
    expect(h).toMatchObject({ minutes: 0, shown: [], peak: undefined })
  })
  it('bridges a gap of one or two slots but counts only lit minutes', () => {
    const row = slots(0, 10, 40).map((v, i) => (i === 5 || i === 6 ? 0 : v))
    const h = dayHeadline(result([row]))
    expect(h.shown).toHaveLength(1)
    expect(h.minutes).toBe(8 * 5)
  })
  it('keeps the two longest of several stretches in clock order', () => {
    const row = [...slots(0, 3, 12), ...slots(0, 8, 12), ...slots(0, 5, 12), ...slots(0, 2, 12)]
    const h = dayHeadline(result([row]))
    expect(h.shown).toEqual([
      { from: 480 + 12 * 5, to: 480 + 20 * 5 },
      { from: 480 + 24 * 5, to: 480 + 29 * 5 },
    ])
    expect(h.more).toBe(true)
    expect(h.minutes).toBe(18 * 5)
  })
  it('puts the peak where most of the floor is lit', () => {
    const h = dayHeadline(result([slots(0, 6, 12), slots(2, 4, 12), slots(2, 4, 12)]))
    expect(h.peak).toBe(480 + 3 * 5) // slots 2 and 3 tie; the later of the middle pair
  })
})

describe('headlineText', () => {
  it('writes the sentence in English', () => {
    const h = dayHeadline(result([slots(32, 76, 100)]))
    expect(rangeText(h.shown[0])).toBe('10:40\u201314:20')
    expect(headlineText(h, day).text).toBe('Sun inside on 21 Dec: 10:40\u201314:20 \u00b7 3 h 40 min')
  })
  it('writes it in Italian', () => {
    useLang('it')
    const h = dayHeadline(result([slots(32, 76, 100)]))
    expect(headlineText(h, day).text).toBe('Sole in casa il 21 dic: 10:40\u201314:20 \u00b7 3 h 40 min')
  })
  it('lists two stretches and an ellipsis when there are more', () => {
    const row = [...slots(0, 3, 12), ...slots(0, 8, 12), ...slots(0, 5, 12), ...slots(0, 2, 12)]
    expect(headlineText(dayHeadline(result([row])), day).text).toMatch(/: \d\d:\d\d\u2013\d\d:\d\d, \d\d:\d\d\u2013\d\d:\d\d, \u2026 \u00b7 /)
  })
  it('says plainly when there is no sun', () => {
    const { text, detail } = headlineText(dayHeadline(result([slots(0, 0, 12)])), day)
    expect(text).toBe('No direct sun inside on 21 Dec')
    expect(detail).not.toBe('')
  })
})
