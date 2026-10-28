import { describe, expect, it } from 'vitest'
import { pointInPolygon, project, unproject } from './osm'

const ORIGIN = { lat: 45.4642, lon: 9.19 }

describe('project', () => {
  it('maps the origin to zero', () => {
    const p = project(ORIGIN.lat, ORIGIN.lon, ORIGIN)
    expect(p.x).toBeCloseTo(0)
    expect(p.z).toBeCloseTo(0)
  })

  it('north is -z, east is +x, about 111.2 km per degree of latitude', () => {
    const n = project(ORIGIN.lat + 0.001, ORIGIN.lon, ORIGIN)
    expect(n.x).toBeCloseTo(0)
    expect(n.z).toBeCloseTo(-111.195, 1)
    const e = project(ORIGIN.lat, ORIGIN.lon + 0.001, ORIGIN)
    expect(e.x).toBeCloseTo(111.195 * Math.cos((ORIGIN.lat * Math.PI) / 180), 1)
    expect(e.z).toBeCloseTo(0)
  })

  it('unproject is the inverse', () => {
    const p = project(45.47, 9.2, ORIGIN)
    const o = unproject(p, ORIGIN)
    expect(o.lat).toBeCloseTo(45.47, 9)
    expect(o.lon).toBeCloseTo(9.2, 9)
  })
})

describe('pointInPolygon', () => {
  // L shape
  const L = [
    { x: 0, z: 0 },
    { x: 10, z: 0 },
    { x: 10, z: 4 },
    { x: 4, z: 4 },
    { x: 4, z: 10 },
    { x: 0, z: 10 },
  ]
  it('detects inside and outside, including the concave notch', () => {
    expect(pointInPolygon({ x: 2, z: 2 }, L)).toBe(true)
    expect(pointInPolygon({ x: 8, z: 2 }, L)).toBe(true)
    expect(pointInPolygon({ x: 2, z: 8 }, L)).toBe(true)
    expect(pointInPolygon({ x: 8, z: 8 }, L)).toBe(false)
    expect(pointInPolygon({ x: -1, z: 2 }, L)).toBe(false)
  })
})
