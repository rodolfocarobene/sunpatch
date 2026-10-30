import { describe, expect, it } from 'vitest'
import { mapIdleHint, selectionGeoJSON } from './map-selection'
import type { Building } from './osm'

const origin = { lat: 45.46, lon: 9.19 }
const square = (x: number, z: number): Building => ({
  id: `way/${x}`,
  outer: [{ x, z }, { x: x + 10, z }, { x: x + 10, z: z + 10 }, { x, z: z + 10 }],
  holes: [],
  minHeight: 0,
  height: 10,
  heightSource: 'default',
  tags: {},
})

describe('mapIdleHint', () => {
  it('guides the first pick only', () => {
    expect(mapIdleHint(false)).toMatch(/pick/)
    expect(mapIdleHint(true)).toBe('')
  })
})

describe('selectionGeoJSON', () => {
  it('is empty when nothing is picked', () => {
    expect(selectionGeoJSON(undefined, origin).features).toEqual([])
    expect(selectionGeoJSON(square(0, 0), undefined).features).toEqual([])
  })
  it('closes the ring and puts north up', () => {
    const [f] = selectionGeoJSON(square(0, 0), origin).features
    const ring = f.geometry.coordinates[0]
    expect(ring).toHaveLength(5)
    expect(ring[0]).toEqual(ring[4])
    expect(ring[3][1]).toBeLessThan(ring[0][1]) // +z is south
    expect(ring[1][0]).toBeGreaterThan(ring[0][0]) // +x is east
  })
  it('outlines every part of a merged selection', () => {
    const a = square(0, 0)
    const b = square(20, 0)
    const merged: Building = { ...a, members: [a, b], sources: [a.id, b.id] }
    expect(selectionGeoJSON(merged, origin).features).toHaveLength(2)
  })
  it('keeps holes as inner rings', () => {
    const a = { ...square(0, 0), holes: [[{ x: 2, z: 2 }, { x: 4, z: 2 }, { x: 4, z: 4 }]] }
    expect(selectionGeoJSON(a, origin).features[0].geometry.coordinates).toHaveLength(2)
  })
})
