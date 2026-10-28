import { describe, expect, it } from 'vitest'
import {
  buildingHeights,
  hiddenOutlines,
  parseLength,
  parseOverpass,
  partsOf,
  pickBuilding,
  pointInPolygon,
  project,
  stitchRings,
  unproject,
  type OverpassElement,
} from './osm'

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

describe('parseLength', () => {
  it('accepts plain numbers and metres, ignores the rest', () => {
    expect(parseLength('12')).toBe(12)
    expect(parseLength('12 m')).toBe(12)
    expect(parseLength('12.5m')).toBe(12.5)
    expect(parseLength('tall')).toBeUndefined()
    expect(parseLength("12'")).toBeUndefined()
    expect(parseLength(undefined)).toBeUndefined()
  })
})

describe('buildingHeights', () => {
  it('prefers the height tag, then levels, then 9 m', () => {
    expect(buildingHeights({ height: '20', 'building:levels': '3' })).toMatchObject({ height: 20, heightSource: 'tag', levels: 3 })
    expect(buildingHeights({ 'building:levels': '4' })).toMatchObject({ height: 12, heightSource: 'levels', levels: 4 })
    expect(buildingHeights({ height: 'x' })).toMatchObject({ height: 9, heightSource: 'default', minHeight: 0 })
  })
  it('reads min_height and building:min_level', () => {
    expect(buildingHeights({ height: '20', min_height: '5' }).minHeight).toBe(5)
    expect(buildingHeights({ height: '20', 'building:min_level': '2' }).minHeight).toBe(6)
    expect(buildingHeights({ height: '4', min_height: '5' }).minHeight).toBe(0)
  })
})

const ll = (lat: number, lon: number) => ({ lat, lon })
const square = (lat: number, lon: number, d: number) => [
  ll(lat, lon), ll(lat, lon + d), ll(lat + d, lon + d), ll(lat + d, lon), ll(lat, lon),
]

describe('stitchRings', () => {
  it('joins split and reversed segments, drops open ones', () => {
    const a = [ll(0, 0), ll(0, 1), ll(1, 1)]
    const b = [ll(0, 0), ll(1, 0), ll(1, 1)] // reversed relative to continuation
    const open = [ll(5, 5), ll(5, 6)]
    const { rings, skipped } = stitchRings([a, b, open])
    expect(rings).toHaveLength(1)
    expect(rings[0]).toHaveLength(5)
    expect(rings[0][0]).toEqual(rings[0][4])
    expect(skipped).toBe(1)
  })
})

describe('parseOverpass', () => {
  const origin = ll(0, 0)
  const els: OverpassElement[] = [
    { type: 'way', id: 1, tags: { building: 'yes', 'building:levels': '2' }, geometry: square(0, 0, 0.0001) },
    { type: 'way', id: 2, tags: { highway: 'residential' }, geometry: square(0, 0, 0.0001) },
    { type: 'way', id: 3, tags: { building: 'yes' }, geometry: square(0, 0, 0.0001).slice(0, 3) },
    {
      type: 'relation', id: 10, tags: { building: 'yes', height: '15 m' },
      members: [
        { type: 'way', ref: 1, role: 'outer', geometry: square(0.001, 0.001, 0.0004).slice(0, 3) },
        { type: 'way', ref: 2, role: 'outer', geometry: square(0.001, 0.001, 0.0004).slice(2) },
        { type: 'way', ref: 3, role: 'inner', geometry: square(0.00115, 0.00115, 0.0001) },
        { type: 'way', ref: 4, role: 'inner', geometry: square(0.01, 0.01, 0.0001) },
      ],
    },
  ]
  const { buildings, skippedRings } = parseOverpass(els, origin)

  it('keeps closed building ways, relations with stitched outers, skips others', () => {
    expect(buildings.map((b) => b.id)).toEqual(['way/1', 'relation/10'])
    expect(skippedRings).toBe(1)
    expect(buildings[0]).toMatchObject({ height: 6, levels: 2, minHeight: 0 })
    expect(buildings[1]).toMatchObject({ height: 15, heightSource: 'tag' })
  })

  it('assigns only the hole inside the outer ring', () => {
    expect(buildings[1].outer).toHaveLength(4)
    expect(buildings[1].holes).toHaveLength(1)
  })

  it('pickBuilding respects holes', () => {
    const rel = buildings[1]
    const inHole = project(0.0012, 0.0012, origin)
    const inSolid = project(0.00105, 0.00105, origin)
    expect(pickBuilding(buildings, inHole)).toBeUndefined()
    expect(pickBuilding(buildings, inSolid)?.id).toBe(rel.id)
  })
})

describe('hiddenOutlines', () => {
  const els: OverpassElement[] = [
    { type: 'way', id: 1, tags: { building: 'yes' }, geometry: square(0, 0, 0.001) },
    { type: 'way', id: 2, tags: { 'building:part': 'yes' }, geometry: square(0, 0, 0.0004) },
    { type: 'way', id: 3, tags: { building: 'yes' }, geometry: square(0.01, 0.01, 0.0004) },
  ]
  const { buildings } = parseOverpass(els, ll(0, 0))

  it('hides only outlines that contain parts', () => {
    expect([...hiddenOutlines(buildings)]).toEqual(['way/1'])
    expect(partsOf(buildings[0], buildings).map((b) => b.id)).toEqual(['way/2'])
  })
})
