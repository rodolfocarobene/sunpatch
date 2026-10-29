import { describe, expect, it } from 'vitest'
import duomo from '../fixtures/overpass-milan-duomo.json'
import murat from '../fixtures/overpass-milan-via-murat.json'
import { mergeSelection, selectBuilding, selectionGroup, sharedWallLength } from './block'
import { parseOverpass, ringArea, type Building, type OverpassElement, type Point } from './osm'

const rect = (x0: number, z0: number, x1: number, z1: number): Point[] => [
  { x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 },
]
const make = (id: string, outer: Point[], tags: Record<string, string> = {}, over: Partial<Building> = {}): Building => ({
  id, outer, holes: [], minHeight: 0, height: 9, heightSource: 'tag', tags: { building: 'yes', ...tags }, ...over,
})
const part = (id: string, outer: Point[], over: Partial<Building> = {}) =>
  make(id, outer, { 'building:part': 'yes' }, over)
const ids = (list: Building[]) => list.map((b) => b.id).sort()

describe('sharedWallLength', () => {
  it('measures the common wall of two neighbours', () => {
    expect(sharedWallLength(rect(0, 0, 10, 10), rect(10, 2, 20, 8))).toBeCloseTo(6)
  })

  it('tolerates a few centimetres of offset but not a street between them', () => {
    expect(sharedWallLength(rect(0, 0, 10, 10), rect(10.2, 0, 20, 10))).toBeCloseTo(10)
    expect(sharedWallLength(rect(0, 0, 10, 10), rect(14, 0, 24, 10))).toBe(0)
  })

  it('is zero for a shared corner', () => {
    expect(sharedWallLength(rect(0, 0, 10, 10), rect(10, 10, 20, 20))).toBe(0)
  })
})

describe('selectionGroup', () => {
  it('does not merge buildings that merely touch (a perimeter block stays several buildings)', () => {
    const a = make('way/1', rect(0, 0, 10, 10))
    const b = make('way/2', rect(10, 0, 20, 10))
    const c = make('way/3', rect(20, 0, 30, 10))
    expect(ids(selectionGroup([a, b, c], b))).toEqual(['way/2'])
    expect(mergeSelection([a, b, c], b)).toBe(b)
  })

  it('merges the outer rings of one relation, but not outer rings that are far apart', () => {
    const a = make('relation/9#1', rect(0, 0, 10, 10))
    const b = make('relation/9#2', rect(10, 0, 20, 10))
    const far = make('relation/9#3', rect(100, 0, 110, 10))
    const merged = mergeSelection([a, b, far], a)
    expect([...merged.sources!].sort()).toEqual(['relation/9#1', 'relation/9#2'])
    expect(ringArea(merged.outer)).toBeCloseTo(200)
  })

  it('merges the same street and house number, never two different numbers', () => {
    const tag = (n: string) => ({ 'addr:street': 'Via Roma', 'addr:housenumber': n })
    const a = make('way/1', rect(0, 0, 10, 10), tag('4'))
    const b = make('way/2', rect(10, 0, 20, 10), tag('4'))
    const c = make('way/3', rect(0, 10, 10, 20), tag('6'))
    expect(ids(selectionGroup([a, b, c], a))).toEqual(['way/1', 'way/2'])
  })

  it('merges overlapping outlines (an upper volume drawn over the same footprint)', () => {
    const lower = make('way/1', rect(0, 0, 20, 10), {}, { height: 9 })
    const upper = make('way/2', rect(0, 0, 10, 10), {}, { minHeight: 9, height: 18 })
    const merged = mergeSelection([lower, upper], upper)
    expect([...merged.sources!].sort()).toEqual(['way/1', 'way/2'])
    expect(merged.id).toBe('way/1')
    expect(merged.height).toBe(18)
    expect(merged.minHeight).toBe(0)
    expect(merged.members).toHaveLength(2)
  })

  it('takes the parts of an outline, hides the outline, and keeps each part height', () => {
    const outline = make('way/1', rect(0, 0, 20, 10))
    const low = part('way/2', rect(0, 0, 8, 10), { height: 6 })
    const high = part('way/3', rect(8, 0, 20, 10), { height: 21, levels: 7, heightSource: 'levels' })
    const next = make('way/4', rect(20, 0, 30, 10))
    const merged = selectBuilding([outline, low, high, next], { x: 15, z: 5 })!
    expect(merged.id).toBe('way/1')
    expect([...merged.sources!].sort()).toEqual(['way/1', 'way/2', 'way/3'])
    expect(ids(merged.members!)).toEqual(['way/2', 'way/3'])
    expect(merged.members!.map((m) => m.height).sort((a, b) => a - b)).toEqual([6, 21])
    expect(merged.height).toBe(21)
    expect(merged.levels).toBe(7)
    expect(ringArea(merged.outer)).toBeCloseTo(200)
  })

  it('a stray part joins the neighbour it shares the longest wall with, and a corner contact joins nothing', () => {
    const house = make('way/1', rect(0, 0, 10, 10))
    const other = make('way/2', rect(0, 10, 4.5, 20))
    const wing = part('way/3', rect(10, 0, 16, 10))
    expect(ids(selectionGroup([house, other, wing], wing))).toEqual(['way/1', 'way/3'])
    const corner = part('way/4', rect(10, 10, 16, 16))
    expect(ids(selectionGroup([house, corner], corner))).toEqual(['way/4'])
  })
})

describe('fixture via Murat', () => {
  const origin = { lat: 45.5024, lon: 9.19 }
  const buildings = parseOverpass(murat.elements as unknown as OverpassElement[], origin).buildings
  const centre = { x: 0, z: 0 }

  it('picks way/438862874 with its five parts as one building of 15 m', () => {
    const merged = selectBuilding(buildings, centre)!
    expect(merged.id).toBe('way/438862874')
    expect(merged.sources).toHaveLength(6)
    expect(merged.members).toHaveLength(5)
    expect(merged.height).toBe(15)
    expect(merged.levels).toBe(5)
    expect(merged.members!.map((m) => m.height).sort((a, b) => a - b)).toEqual([3, 3, 3, 15, 15])
    expect(ringArea(merged.outer)).toBeCloseTo(1130, -1)
  })

  it('does not take the touching building next door', () => {
    const merged = selectBuilding(buildings, centre)!
    expect(merged.sources).not.toContain('way/39644754')
  })

  it('selects the same building whichever of its polygons is clicked', () => {
    const outline = selectBuilding(buildings, centre)!
    const partOnly = mergeSelection(buildings, buildings.find((b) => b.id === 'way/438862863')!)
    expect(partOnly.id).toBe(outline.id)
    expect([...partOnly.sources!].sort()).toEqual([...outline.sources!].sort())
  })
})

describe('fixture Milan example', () => {
  it('keeps Palazzo Reale a single polygon, so the example is unchanged', () => {
    const buildings = parseOverpass(duomo.elements as unknown as OverpassElement[], { lat: 45.46278, lon: 9.19104 }).buildings
    const reale = buildings.find((b) => b.id.startsWith('relation/36488'))!
    expect(mergeSelection(buildings, reale)).toBe(reale)
  })
})
