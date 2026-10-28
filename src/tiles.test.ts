import { describe, expect, it } from 'vitest'
import { project, snapBuilding } from './osm'
import { tileBuildings } from './tiles'

const O = { lat: 45, lon: 9 }
// ~0.0001 deg is about 11 m north-south, 7.8 m east-west here.
const square = (lon: number, lat: number, d = 0.0001): [number, number][] =>
  [[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]
const poly = (coordinates: unknown, properties: Record<string, unknown> = {}) =>
  ({ geometry: { type: 'Polygon', coordinates }, properties })

describe('tileBuildings', () => {
  it('converts a polygon, dropping the closing point and keeping holes', () => {
    const hole = square(9.00002, 45.00002, 0.00005)
    const [b] = tileBuildings([poly([square(9, 45), hole], { render_height: 20, render_min_height: 3 })], O, 250)
    expect(b.outer).toHaveLength(4)
    expect(b.holes).toHaveLength(1)
    expect(b.holes[0]).toHaveLength(4)
    expect(b).toMatchObject({ id: 'tile/0', height: 20, minHeight: 3, heightSource: 'tile', tags: {} })
    expect(b.outer[0].x).toBeCloseTo(0)
    expect(b.outer[0].z).toBeCloseTo(0)
  })

  it('defaults the heights and ignores a min height above the roof', () => {
    const [a, b] = tileBuildings(
      [poly([square(9, 45)]), poly([square(9.001, 45)], { render_height: 5, render_min_height: 8 })], O, 250)
    expect(a).toMatchObject({ height: 9, minHeight: 0 })
    expect(b.minHeight).toBe(0)
  })

  it('splits a MultiPolygon and numbers each polygon', () => {
    const f = { geometry: { type: 'MultiPolygon', coordinates: [[square(9, 45)], [square(9.0005, 45)]] }, properties: {} }
    expect(tileBuildings([f], O, 250).map((b) => b.id)).toEqual(['tile/0', 'tile/1'])
  })

  it('skips hide_3d outlines and non-polygons', () => {
    const line = { geometry: { type: 'LineString', coordinates: [[9, 45], [9.1, 45]] }, properties: {} }
    expect(tileBuildings([poly([square(9, 45)], { hide_3d: true }), line], O, 250)).toEqual([])
  })

  it('drops exact duplicates from neighbouring tiles', () => {
    expect(tileBuildings([poly([square(9, 45)]), poly([square(9, 45)])], O, 250)).toHaveLength(1)
  })

  it('skips polygons beyond the radius, keeping ids stable', () => {
    const far = poly([square(9.01, 45)]) // ~790 m east
    const near = poly([square(9, 45)])
    expect(tileBuildings([far, near], O, 250).map((b) => b.id)).toEqual(['tile/1'])
    expect(tileBuildings([far, near], O, 2000).map((b) => b.id)).toEqual(['tile/0', 'tile/1'])
  })
})

describe('snapBuilding', () => {
  const buildings = tileBuildings([poly([square(9, 45)])], O, 250)
  it('finds the building containing the point', () => {
    expect(snapBuilding(buildings, project(45.00005, 9.00005, O))?.id).toBe('tile/0')
  })
  it('snaps to a building within 20 m, not beyond', () => {
    expect(snapBuilding(buildings, project(45.00005, 9.0003, O))?.id).toBe('tile/0') // ~16 m east
    expect(snapBuilding(buildings, project(45.00005, 9.001, O))).toBeUndefined()
  })
})
