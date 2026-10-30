import { describe, expect, it } from 'vitest'
import { countBuildings, covers, dataExtent, neighborhoodLine, neighborhoodRadius, NEIGHBORHOODS, parseNeighborhood, withinRadius } from './neighborhood'
import type { Building } from './osm'

const box = (id: string, x: number): Building =>
  ({ id, tags: { building: 'yes' }, outer: [{ x, z: 0 }, { x: x + 10, z: 0 }, { x: x + 10, z: 10 }, { x, z: 10 }], holes: [], height: 9, minHeight: 0 }) as unknown as Building

describe('neighborhood', () => {
  it('has growing radii and medium as the old behaviour', () => {
    const r = NEIGHBORHOODS.map((n) => n.radiusM)
    expect([...r].sort((a, b) => a - b)).toEqual(r)
    expect(neighborhoodRadius('medium')).toBe(300)
  })

  it('reads a stored value, falling back to medium', () => {
    expect(parseNeighborhood('large')).toBe('large')
    expect(parseNeighborhood('huge')).toBe('medium')
    expect(parseNeighborhood(null)).toBe('medium')
  })

  it('keeps buildings by their nearest edge, and the kept ids whatever their distance', () => {
    const all = [box('a', 100), box('b', 140), box('c', 151), box('d', 400)]
    expect(withinRadius(all, 150).map((b) => b.id)).toEqual(['a', 'b'])
    expect(withinRadius(all, 120).map((b) => b.id)).toEqual(['a'])
    expect(withinRadius(all, 120, ['d']).map((b) => b.id)).toEqual(['a', 'd'])
  })

  it('counts buildings, not their parts', () => {
    const part = { ...box('p', 0), tags: { 'building:part': 'yes' } }
    const both = { ...box('q', 0), tags: { 'building:part': 'yes', building: 'yes' } }
    expect(countBuildings([box('a', 0), { ...box('t', 0), tags: {} }, part, both])).toBe(4 - 1)
  })

  it('knows when fetched data covers a circle', () => {
    expect(covers(450, 100, 350)).toBe(true)
    expect(covers(450, 101, 350)).toBe(false)
    expect(covers(450, 0, 500)).toBe(false)
  })

  it('words the count', () => {
    expect(neighborhoodLine(214, 300)).toBe('214 buildings within 300 m')
    expect(neighborhoodLine(1, 150)).toBe('1 building within 150 m')
    expect(neighborhoodLine(1234, 500)).toBe('1,234 buildings within 500 m')
  })

  it('sizes the ground and shadow frustum to cover the radius', () => {
    for (const { radiusM } of NEIGHBORHOODS) {
      const e = dataExtent(radiusM)
      expect(e.ground / 2).toBeGreaterThan(radiusM)
      expect(e.shadow).toBeGreaterThan(radiusM)
      expect(e.sunDistance).toBeGreaterThanOrEqual(radiusM)
    }
    expect(dataExtent(500).shadow).toBeGreaterThan(dataExtent(150).shadow)
  })
})
