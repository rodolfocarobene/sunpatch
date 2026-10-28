// Sun times depend on the local day: pin the zone the Milan expectations are written for.
;(globalThis as unknown as { process: { env: Record<string, string> } }).process.env.TZ = 'Europe/Rome'

import { describe, expect, it } from 'vitest'
import { activePreset, DAY_MAX, daylight, nextPlayMinute, presetDates, startMinutes, stripGradient } from './daylight'

const LAT = 45.4642
const LON = 9.19
// The strip and Play work in browser-local days, so the tests build local dates too.
const local = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min)

describe('presetDates', () => {
  const today = local(2026, 10, 28)
  it('uses the given year and the northern solstices', () => {
    const p = presetDates(2027, LAT, today)
    expect(p.map((x) => [x.id, x.date])).toEqual([
      ['winter', '2027-12-21'],
      ['equinox', '2027-03-20'],
      ['summer', '2027-06-21'],
      ['today', '2026-10-28'],
    ])
    expect(p[0].title).toBe('Winter solstice, 21 December')
  })
  it('swaps winter and summer south of the equator', () => {
    const p = presetDates(2026, -33.9, today)
    expect(p.find((x) => x.id === 'winter')).toMatchObject({ date: '2026-06-21', title: 'Winter solstice, 21 June' })
    expect(p.find((x) => x.id === 'summer')!.date).toBe('2026-12-21')
  })
  it('finds the active preset by date', () => {
    const p = presetDates(2026, LAT, today)
    expect(activePreset(p, '2026-06-21')).toBe('summer')
    expect(activePreset(p, '2026-07-01')).toBeUndefined()
  })
})

describe('daylight', () => {
  it('Milan on 21 Dec: short day, noon near 12:00, sunrise before sunset', () => {
    const d = daylight(local(2026, 12, 21), LAT, LON)
    expect(d.polar).toBeNull()
    expect(d.sunrise!).toBeGreaterThan(7 * 60)
    expect(d.sunrise!).toBeLessThan(8.5 * 60)
    expect(d.sunset!).toBeGreaterThan(16 * 60)
    expect(d.sunset!).toBeLessThan(17.5 * 60)
    expect(Math.abs(d.noon - 12.5 * 60)).toBeLessThan(75)
  })
  it('summer days are longer than winter days', () => {
    const w = daylight(local(2026, 12, 21), LAT, LON)
    const s = daylight(local(2026, 6, 21), LAT, LON)
    expect(s.sunset! - s.sunrise!).toBeGreaterThan(w.sunset! - w.sunrise!)
  })
  it('segments tile 0..1 in order, night first and last', () => {
    const { segments } = daylight(local(2026, 3, 20), LAT, LON)
    expect(segments[0].from).toBe(0)
    expect(segments[segments.length - 1].to).toBe(1)
    for (let i = 1; i < segments.length; i++) expect(segments[i].from).toBe(segments[i - 1].to)
    expect(segments[0].band).toBe('night')
    expect(segments[segments.length - 1].band).toBe('night')
    expect(segments.some((s) => s.band === 'day')).toBe(true)
  })
  it('polar day has no night and polar night has no daylight', () => {
    const day = daylight(local(2026, 6, 21), 78.2, 15.6) // Svalbard
    expect(day.polar).toBe('day')
    expect(day.sunrise).toBe(0)
    expect(day.sunset).toBe(DAY_MAX)
    const night = daylight(local(2026, 12, 21), 78.2, 15.6)
    expect(night.polar).toBe('night')
    expect(night.sunrise).toBeNull()
    expect(night.segments.some((s) => s.band === 'day')).toBe(false)
  })
  it('a mirrored southern latitude has the long day in December', () => {
    const dec = daylight(local(2026, 12, 21), -LAT, LON)
    const jun = daylight(local(2026, 6, 21), -LAT, LON)
    expect(dec.sunset! - dec.sunrise!).toBeGreaterThan(jun.sunset! - jun.sunrise!)
  })
})

describe('stripGradient', () => {
  it('builds a hard-stop gradient from the segments', () => {
    const css = stripGradient([
      { band: 'night', from: 0, to: 0.3 },
      { band: 'day', from: 0.3, to: 1 },
    ])
    expect(css).toBe('linear-gradient(to right, var(--strip-night) 0% 30%, var(--strip-day) 30% 100%)')
  })
})

describe('startMinutes', () => {
  it('keeps the current time (to the step) while the sun is up', () => {
    expect(startMinutes(local(2026, 6, 21, 14, 37), LAT, LON)).toBe(14 * 60 + 35)
  })
  it('jumps to solar noon at night', () => {
    const noon = daylight(local(2026, 12, 21), LAT, LON).noon
    expect(startMinutes(local(2026, 12, 21, 23, 10), LAT, LON)).toBe(noon)
    expect(startMinutes(local(2026, 12, 21, 3, 0), LAT, LON)).toBe(noon)
  })
})

describe('nextPlayMinute', () => {
  const window = { sunrise: 482, sunset: 1003 } // 08:02, 16:43
  it('steps by 5 minutes inside the window', () => {
    expect(nextPlayMinute(600, window)).toBe(605)
  })
  it('starts at sunrise (to the next step) when outside the window', () => {
    expect(nextPlayMinute(120, window)).toBe(485)
    expect(nextPlayMinute(1200, window)).toBe(485)
  })
  it('wraps to sunrise after sunset', () => {
    expect(nextPlayMinute(1000, window)).toBe(485)
  })
  it('plays the whole day with no sunrise or sunset', () => {
    expect(nextPlayMinute(100, { sunrise: null, sunset: null })).toBe(105)
    expect(nextPlayMinute(DAY_MAX, { sunrise: null, sunset: null })).toBe(0)
  })
})
