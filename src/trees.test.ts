import { describe, expect, it } from 'vitest'
import { unproject, type OverpassElement, type Point } from './osm'
import { buildTreeGroup, inArea, parseGreen, scatterTrees, seededRandom, type Green, type GreenArea } from './trees'

const square = (x: number, z: number, s: number): Point[] => [
  { x, z },
  { x: x + s, z },
  { x: x + s, z: z + s },
  { x, z: z + s },
]
const area = (over: Partial<GreenArea> = {}): GreenArea => ({
  id: 'way/1',
  outer: square(-50, -50, 100),
  holes: [],
  spacing: 8,
  ...over,
})
const green = (...areas: GreenArea[]): Green => ({ areas, trees: [] })

describe('scatterTrees', () => {
  it('stays inside the polygon and out of its holes', () => {
    const a = area({ holes: [square(-20, -20, 40)] })
    const trees = scatterTrees(green(a), [])
    expect(trees.length).toBeGreaterThan(50)
    for (const t of trees) expect(inArea(a, t)).toBe(true)
  })

  it('is deterministic for the same area', () => {
    const a = scatterTrees(green(area()), [])
    const b = scatterTrees(green(area()), [])
    expect(b).toEqual(a)
    expect(scatterTrees(green(area({ id: 'way/2' })), [])).not.toEqual(a)
  })

  it('keeps the spacing', () => {
    const trees = scatterTrees(green(area({ spacing: 8 })), [])
    for (let i = 0; i < trees.length; i++) {
      for (let j = i + 1; j < trees.length; j++) {
        expect(Math.hypot(trees[i].x - trees[j].x, trees[i].z - trees[j].z)).toBeGreaterThanOrEqual(8)
      }
    }
  })

  it('caps the total, mapped trees included', () => {
    const mapped = { x: 0, z: 0, height: 8, crown: 2, shade: 0.5 }
    const trees = scatterTrees({ areas: [area()], trees: [mapped] }, [], { maxTrees: 20 })
    expect(trees).toHaveLength(20)
    expect(trees[0]).toEqual(mapped)
  })

  it('keeps clear of buildings and their margin', () => {
    const building = { outer: square(-10, -10, 20), holes: [] }
    const trees = scatterTrees(green(area()), [building], { margin: 4 })
    expect(trees.length).toBeGreaterThan(50)
    for (const t of trees) {
      const clearX = t.x < -14 || t.x > 14
      const clearZ = t.z < -14 || t.z > 14
      expect(clearX || clearZ).toBe(true)
    }
  })

  it('skips trees beyond the radius and keeps mapped trees exactly', () => {
    const far = { x: 400, z: 0, height: 8, crown: 2, shade: 0.5 }
    const near = { x: 5, z: 6, height: 9, crown: 2, shade: 0.1 }
    expect(scatterTrees({ areas: [], trees: [far, near] }, [])).toEqual([near])
    const trees = scatterTrees(green(area({ outer: square(250, 250, 200) })), [])
    for (const t of trees) expect(Math.hypot(t.x, t.z)).toBeLessThanOrEqual(300)
  })

  it('draws the same random sequence for the same seed', () => {
    expect(seededRandom('a')()).toBe(seededRandom('a')())
    expect(seededRandom('a')()).not.toBe(seededRandom('b')())
  })
})

describe('parseGreen', () => {
  const origin = { lat: 45, lon: 9 }
  const at = (p: Point) => unproject(p, origin)
  const ring = (pts: Point[]) => [...pts, pts[0]].map(at)
  const elements: OverpassElement[] = [
    { type: 'way', id: 1, tags: { leisure: 'park' }, geometry: ring(square(0, 0, 50)) },
    { type: 'way', id: 2, tags: { highway: 'residential' }, geometry: ring(square(0, 0, 50)) },
    { type: 'way', id: 3, tags: { building: 'yes' }, geometry: ring(square(0, 0, 50)) },
    { type: 'node', id: 4, tags: { natural: 'tree', height: '30' }, ...at({ x: 10, z: 20 }) } as unknown as OverpassElement,
    { type: 'way', id: 5, tags: { natural: 'tree_row' }, geometry: [at({ x: 0, z: 0 }), at({ x: 30, z: 0 })] },
    {
      type: 'relation',
      id: 6,
      tags: { landuse: 'forest' },
      members: [
        { type: 'way', ref: 7, role: 'outer', geometry: ring(square(0, 0, 100)) },
        { type: 'way', ref: 8, role: 'inner', geometry: ring(square(40, 40, 20)) },
      ],
    },
  ]

  it('reads areas, holes, single trees and tree rows', () => {
    const g = parseGreen(elements, origin)
    expect(g.areas.map((a) => a.id)).toEqual(['way/1', 'relation/6#0'])
    expect(g.areas[1].holes).toHaveLength(1)
    expect(g.areas[1].spacing).toBeLessThan(g.areas[0].spacing)
    const node = g.trees[0]
    expect(node.x).toBeCloseTo(10, 1)
    expect(node.z).toBeCloseTo(20, 1)
    expect(node.height).toBe(25) // clamped
    const row = g.trees.slice(1)
    expect(row).toHaveLength(5) // 0, 7, 14, 21, 28
    expect(row[1].x).toBeCloseTo(7, 1)
  })
})

describe('buildTreeGroup', () => {
  it('uses two instanced meshes for any number of trees', () => {
    const trees = scatterTrees(green(area()), [])
    const group = buildTreeGroup(trees)
    expect(group.children).toHaveLength(2)
    for (const m of group.children) {
      expect((m as unknown as { count: number }).count).toBe(trees.length)
      expect(m.castShadow).toBe(true)
    }
    expect(buildTreeGroup([]).children).toHaveLength(0)
  })
})
