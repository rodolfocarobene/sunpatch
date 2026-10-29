import { describe, expect, it } from 'vitest'
import duomo from '../fixtures/overpass-milan-duomo.json'
import murat from '../fixtures/overpass-milan-via-murat.json'
import {
  floodSelection,
  MAX_SELECTION_POLYGONS,
  MAX_SELECTION_RADIUS_M,
  mergeSelection,
  restoreSelection,
  selectBuilding,
  selectionGroup,
  selectionIds,
  sharedWallLength,
  togglePart,
} from './block'
import { parseOverpass, project, ringArea, type Building, type OverpassElement, type Point } from './osm'

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
  it('merges buildings that touch along a wall, transitively, and not those across a street', () => {
    const a = make('way/1', rect(0, 0, 10, 10))
    const b = make('way/2', rect(10, 0, 20, 10))
    const c = make('way/3', rect(20, 0, 30, 10))
    const across = make('way/4', rect(0, 20, 10, 30))
    expect(ids(selectionGroup([a, b, c, across], a))).toEqual(['way/1', 'way/2', 'way/3'])
    expect(ids(selectionGroup([a, b, c, across], across))).toEqual(['way/4'])
  })

  it('joins walls that are a few centimetres apart, but a corner or a short jog is not a wall', () => {
    const a = make('way/1', rect(0, 0, 10, 10))
    expect(ids(selectionGroup([a, make('way/2', rect(10.2, 0, 20, 10))], a))).toHaveLength(2)
    expect(ids(selectionGroup([a, make('way/3', rect(10, 10, 20, 20))], a))).toEqual(['way/1'])
    expect(ids(selectionGroup([a, make('way/4', rect(10, 3, 20, 3.8))], a))).toEqual(['way/1'])
    expect(ids(selectionGroup([a, make('way/5', rect(10, 3, 20, 4.2))], a))).toHaveLength(2)
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
    const c = make('way/3', rect(0, 30, 10, 40), tag('6'))
    const far = make('way/4', rect(60, 0, 70, 10), tag('4'))
    expect(ids(selectionGroup([a, b, c, far], a))).toEqual(['way/1', 'way/2', 'way/4'])
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
    const next = make('way/4', rect(30, 0, 40, 10))
    const merged = selectBuilding([outline, low, high, next], { x: 15, z: 5 })!
    expect(merged.id).toBe('way/1')
    expect([...merged.sources!].sort()).toEqual(['way/1', 'way/2', 'way/3'])
    expect(ids(merged.members!)).toEqual(['way/2', 'way/3'])
    expect(merged.members!.map((m) => m.height).sort((a, b) => a - b)).toEqual([6, 21])
    expect(merged.height).toBe(21)
    expect(merged.levels).toBe(7)
    expect(ringArea(merged.outer)).toBeCloseTo(200)
  })

  it('a part joins the building it lies in, and a part touching only at a corner joins nothing', () => {
    const house = make('way/1', rect(0, 0, 10, 10))
    const inside = part('way/2', rect(2, 2, 6, 6))
    expect(ids(selectionGroup([house, inside], inside))).toEqual(['way/1', 'way/2'])
    const corner = part('way/4', rect(10, 10, 16, 16))
    expect(ids(selectionGroup([house, corner], corner))).toEqual(['way/4'])
  })

  it('stops at the cap and says so', () => {
    const row = Array.from({ length: MAX_SELECTION_POLYGONS + 10 }, (_, i) => make(`way/${i}`, rect(i * 3, 0, i * 3 + 3, 10)))
    const { group, capped } = floodSelection(row, row[0])
    expect(group).toHaveLength(MAX_SELECTION_POLYGONS)
    expect(capped).toBe(true)
    expect(mergeSelection(row, row[0]).capped).toBe(true)
    expect(floodSelection(row.slice(0, 5), row[0]).capped).toBe(false)
  })

  it('stops at the radius from the click', () => {
    const row = Array.from({ length: 40 }, (_, i) => make(`way/${i}`, rect(i * 10, 0, i * 10 + 10, 10)))
    const { group, capped } = floodSelection(row, row[0], { x: 5, z: 5 })
    expect(capped).toBe(true)
    expect(group.length).toBeLessThanOrEqual(MAX_SELECTION_RADIUS_M / 10 + 1)
  })
})

describe('togglePart', () => {
  const a = make('way/1', rect(0, 0, 10, 10), {}, { height: 12 })
  const b = make('way/2', rect(10, 0, 20, 10), {}, { height: 20 })
  const c = make('way/3', rect(20, 0, 30, 10), {}, { height: 6 })
  const away = make('way/4', rect(0, 30, 10, 40))
  const all = [a, b, c, away]
  const start = selectBuilding(all, { x: 5, z: 5 })!

  it('removes a part and adds it back', () => {
    const removed = togglePart(all, start, 'way/3')
    expect('selected' in removed && removed.selected.sources!.sort()).toEqual(['way/1', 'way/2'])
    const trimmed = (removed as { selected: Building }).selected
    expect(trimmed.id).toBe(start.id)
    expect(trimmed.height).toBe(20)
    const added = togglePart(all, trimmed, 'way/3')
    expect('selected' in added && added.selected.sources!.sort()).toEqual(['way/1', 'way/2', 'way/3'])
  })

  it('drops what a removal cuts off, and never removes the clicked part', () => {
    const cut = togglePart(all, start, 'way/2') as { selected: Building }
    expect(cut.selected).toBe(a)
    expect(togglePart(all, start, 'way/1')).toHaveProperty('hint')
  })

  it('does not add a building that does not touch the selection', () => {
    expect(togglePart(all, start, 'way/4')).toHaveProperty('hint')
  })

  it('restores a stored selection with its plan key', () => {
    const trimmed = (togglePart(all, start, 'way/3') as { selected: Building }).selected
    const back = restoreSelection(all, { x: 5, z: 5 }, { id: trimmed.id, ids: selectionIds(trimmed) })!
    expect(back.id).toBe(trimmed.id)
    expect(selectionIds(back).sort()).toEqual(['way/1', 'way/2'])
    expect(restoreSelection(all, { x: 5, z: 5 }, { id: 'x', ids: ['gone'] })!.sources).toHaveLength(3)
  })
})

describe('fixture via Murat', () => {
  const origin = { lat: 45.5024, lon: 9.19 }
  const buildings = parseOverpass(murat.elements as unknown as OverpassElement[], origin).buildings
  const centre = { x: 0, z: 0 }

  it('picks way/438862874 with its five parts and the touching buildings around it', () => {
    const merged = selectBuilding(buildings, centre)!
    expect(merged.id).toBe('way/438862874')
    expect(merged.sources).toHaveLength(8)
    expect(merged.sources).toContain('way/39644754')
    expect(merged.height).toBe(15)
    expect(merged.levels).toBe(5)
  })

  it('selects the same building whichever of its polygons is clicked', () => {
    const outline = selectBuilding(buildings, centre)!
    const partOnly = mergeSelection(buildings, buildings.find((b) => b.id === 'way/438862863')!)
    expect(partOnly.id).toBe(outline.id)
    expect([...partOnly.sources!].sort()).toEqual([...outline.sources!].sort())
  })
})

describe('fixture via Murat 60', () => {
  const click = { lat: 45.50058, lon: 9.19057 }
  const buildings = parseOverpass(murat.elements as unknown as OverpassElement[], click).buildings
  const at = project(click.lat, click.lon, click)

  it('selects way/650818707 together with the 7 and 9 level buildings it touches', () => {
    const merged = selectBuilding(buildings, at)!
    expect(merged.anchor).toBe('way/650818707')
    expect(merged.sources).toEqual(expect.arrayContaining(['way/650818707', 'way/650818705', 'way/650818712']))
    expect(merged.capped).toBeUndefined()
    const levels = merged.members!.map((m) => m.levels)
    expect(levels).toEqual(expect.arrayContaining([6, 7, 9]))
    expect(merged.height).toBe(27)
  })

  it('selects the same buildings whichever of them is clicked', () => {
    const a = selectBuilding(buildings, at)!
    const b = mergeSelection(buildings, buildings.find((x) => x.id === 'way/650818712')!)
    expect([...b.sources!].sort()).toEqual([...a.sources!].sort())
    expect(b.id).toBe(a.id)
  })

  it('trims one part and adds it back with shift-click', () => {
    const merged = selectBuilding(buildings, at)!
    const out = togglePart(buildings, merged, 'way/650818712')
    expect('selected' in out).toBe(true)
    const trimmed = (out as { selected: Building }).selected
    expect(trimmed.sources).not.toContain('way/650818712')
    expect(trimmed.sources).toContain('way/650818707')
    expect(trimmed.id).toBe(merged.id)
    const back = (togglePart(buildings, trimmed, 'way/650818712') as { selected: Building }).selected
    // Only that part comes back: whatever it was the sole link to stays out until it is clicked too.
    expect([...back.sources!].sort()).toEqual([...trimmed.sources!, 'way/650818712'].sort())
  })
})

describe('fixture Milan example', () => {
  const buildings = parseOverpass(duomo.elements as unknown as OverpassElement[], { lat: 45.46278, lon: 9.19104 }).buildings
  const reale = buildings.find((b) => b.id.startsWith('relation/36488'))!

  it('clicking Palazzo Reale selects it with the touching polygons around it', () => {
    const merged = mergeSelection(buildings, reale)
    expect(merged.sources).toContain(reale.id)
    expect(merged.sources!.length).toBeGreaterThan(1)
    expect(merged.capped).toBeUndefined()
  })

  it('keeps the example on the palace polygon alone, so it is unchanged', () => {
    expect(mergeSelection(buildings, reale, { ids: [reale.id] })).toBe(reale)
  })
})
