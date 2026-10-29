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

describe('tile pieces', () => {
  // One building, 0.0002 deg wide, cut at lon 9.0001 (a tile border): two pieces meeting on the cut.
  const left = square(9, 45, 0.0001)
  const right = square(9.0001, 45, 0.0001)
  const tall = { render_height: 22 }

  it('joins the pieces that share a feature id into one footprint', () => {
    const out = tileBuildings([{ id: 7, ...poly([left], tall) }, { id: 7, ...poly([right], tall) }], O, 250)
    expect(out).toHaveLength(1)
    expect(out[0].height).toBe(22)
    const xs = out[0].outer.map((p) => p.x)
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(15.6, 0)
    expect(out[0].outer).toHaveLength(4)
  })

  it('joins pieces without ids when they meet on a line of constant longitude', () => {
    expect(tileBuildings([poly([left], tall), poly([right], tall)], O, 250)).toHaveLength(1)
  })

  it('joins pieces that overlap by the tile buffer', () => {
    const wide = [[9.00009, 45], [9.00019, 45], [9.00019, 45.0001], [9.00009, 45.0001], [9.00009, 45]]
    expect(tileBuildings([{ id: 3, ...poly([left], tall) }, { id: 3, ...poly([wide], tall) }], O, 250)).toHaveLength(1)
  })

  it('keeps pieces apart when the ids differ or the heights differ', () => {
    expect(tileBuildings([{ id: 1, ...poly([left], tall) }, { id: 2, ...poly([right], tall) }], O, 250)).toHaveLength(2)
    expect(tileBuildings([poly([left], tall), poly([right], { render_height: 9 })], O, 250)).toHaveLength(2)
  })

  it('does not join without ids when the shared wall is not on a tile line', () => {
    // Two triangles sharing the diagonal of the square.
    const lower = [[9, 45], [9.0001, 45], [9, 45.0001], [9, 45]]
    const upper = [[9.0001, 45], [9.0001, 45.0001], [9, 45.0001], [9.0001, 45]]
    expect(tileBuildings([poly([lower], tall), poly([upper], tall)], O, 250)).toHaveLength(2)
  })

  it('joins a chain of pieces cut at two borders', () => {
    const third = square(9.0002, 45, 0.0001)
    const out = tileBuildings([1, 1, 1].map((id, i) => ({ id, ...poly([[left, right, third][i]], tall) })), O, 250)
    expect(out).toHaveLength(1)
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
