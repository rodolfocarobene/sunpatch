import SunCalc from 'suncalc'
import { describe, expect, it } from 'vitest'
import { compassName, sunDirection } from './sun'

const LAT = 45.4642
const LON = 9.19

describe('sunDirection', () => {
  it('June solstice solar noon in Milan: high sun due south', () => {
    const noon = SunCalc.getTimes(new Date(Date.UTC(2026, 5, 21, 12)), LAT, LON).solarNoon
    const s = sunDirection(noon, LAT, LON)
    expect(s.altitudeDeg).toBeCloseTo(90 - LAT + 23.44, 0)
    expect(Math.abs(s.azimuthDeg - 180)).toBeLessThan(1.5)
    expect(s.vector.z).toBeGreaterThan(0)
    expect(Math.abs(s.vector.x)).toBeLessThan(0.03)
  })

  it('morning sun is in the east, afternoon sun in the west', () => {
    const noon = SunCalc.getTimes(new Date(Date.UTC(2026, 5, 21, 12)), LAT, LON).solarNoon
    const am = sunDirection(new Date(noon.getTime() - 4 * 3600e3), LAT, LON)
    const pm = sunDirection(new Date(noon.getTime() + 4 * 3600e3), LAT, LON)
    expect(am.vector.x).toBeGreaterThan(0)
    expect(pm.vector.x).toBeLessThan(0)
    expect(am.azimuthDeg).toBeLessThan(180)
    expect(pm.azimuthDeg).toBeGreaterThan(180)
  })

  it('sun is below the horizon at solar midnight', () => {
    const noon = SunCalc.getTimes(new Date(Date.UTC(2026, 5, 21, 12)), LAT, LON).solarNoon
    const s = sunDirection(new Date(noon.getTime() + 12 * 3600e3), LAT, LON)
    expect(s.altitudeDeg).toBeLessThan(0)
    expect(s.vector.y).toBeLessThan(0)
  })

  it('equinox solar noon altitude is about 90 - latitude', () => {
    const noon = SunCalc.getTimes(new Date(Date.UTC(2026, 2, 20, 12)), LAT, LON).solarNoon
    expect(sunDirection(noon, LAT, LON).altitudeDeg).toBeCloseTo(90 - LAT, 0)
  })

  it('returns a unit vector', () => {
    const { vector: v } = sunDirection(new Date(Date.UTC(2026, 8, 1, 8)), LAT, LON)
    expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(1, 10)
  })
})

describe('compassName', () => {
  it('names the 16 points and wraps around', () => {
    expect(compassName(0)).toBe('N')
    expect(compassName(359)).toBe('N')
    expect(compassName(203)).toBe('SSW')
    expect(compassName(90)).toBe('E')
    expect(compassName(-90)).toBe('W')
  })
})
