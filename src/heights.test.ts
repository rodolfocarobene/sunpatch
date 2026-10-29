import { describe, expect, it } from 'vitest'
import duomo from '../fixtures/overpass-milan-duomo.json'
import { mergeSelection } from './block'
import { validatePlan } from './editor-geom'
import {
  applyHeights, heightIn, isGuessed, keepKnown, overrideFor, parseHeights, reselect, validHeight,
} from './heights'
import { buildingHeights, parseOverpass, type Building, type OverpassElement, type Point } from './osm'
import { buildingLine } from './building-line'
import { defaultPlan, levelCount, rebasePlan } from './plan'
import { tileBuildings } from './tiles'

const rect = (x0: number, z0: number, x1: number, z1: number): Point[] => [
  { x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 },
]
const make = (id: string, outer: Point[], tags: Record<string, string> = {}, over: Partial<Building> = {}): Building => ({
  id, outer, holes: [], ...buildingHeights(tags), tags: { building: 'yes', ...tags }, ...over,
})
const O = { lat: 45, lon: 9 }

describe('isGuessed', () => {
  it('counts the 9 m default and heights estimated from parts, not data', () => {
    expect(isGuessed(make('a', rect(0, 0, 5, 5)))).toBe(true)
    expect(isGuessed(make('a', rect(0, 0, 5, 5), { height: '12' }))).toBe(false)
    expect(isGuessed(make('a', rect(0, 0, 5, 5), { 'building:levels': '4' }))).toBe(false)
    expect(isGuessed(make('a', rect(0, 0, 5, 5), {}, { heightSource: 'parts' }))).toBe(true)
    expect(isGuessed(make('a', rect(0, 0, 5, 5), {}, { heightSource: 'user' }))).toBe(false)
  })

  it('treats a map-tile building without render_height as a guess', () => {
    const ring = [[9, 45], [9.0002, 45], [9.0002, 45.0002], [9, 45.0002], [9, 45]]
    const feature = (properties: Record<string, unknown>) =>
      ({ id: 1, properties, geometry: { type: 'Polygon', coordinates: [ring] } }) as never
    expect(isGuessed(tileBuildings([feature({})], O, 250)[0])).toBe(true)
    expect(isGuessed(tileBuildings([feature({ render_height: 20 })], O, 250)[0])).toBe(false)
  })

  it('marks an outline raised from its parts as estimated, not as data', () => {
    const { buildings } = parseOverpass((duomo as { elements: OverpassElement[] }).elements, { lat: 45.4642, lon: 9.19 })
    const raised = buildings.filter((b) => b.heightSource === 'parts')
    expect(raised.length).toBeGreaterThan(0)
    expect(raised.every(isGuessed)).toBe(true)
  })
})

describe('applyHeights', () => {
  const a = make('way/1', rect(0, 0, 10, 10))
  const b = make('way/2', rect(20, 0, 30, 10), { height: '12' })

  it('replaces height, source and levels, and remembers the data', () => {
    const [x, y] = applyHeights([a, b], { 'way/1': { height: 21, levels: 7 } })
    expect(x).toMatchObject({ height: 21, levels: 7, heightSource: 'user', dataHeight: { height: 9, heightSource: 'default' } })
    expect(y).toBe(b)
    expect(a.heightSource).toBe('default') // the data is not touched
  })

  it('drops levels when the height was given in metres', () => {
    const levelled = make('way/1', rect(0, 0, 10, 10), { 'building:levels': '3' })
    const [x] = applyHeights([levelled], { 'way/1': { height: 20 } })
    expect(x.levels).toBeUndefined()
  })

  it('keeps the data minHeight unless the override has one, and ignores one above the height', () => {
    const raised = make('way/1', rect(0, 0, 10, 10), { min_height: '4', height: '10' })
    expect(applyHeights([raised], { 'way/1': { height: 20 } })[0].minHeight).toBe(4)
    expect(applyHeights([raised], { 'way/1': { height: 20, minHeight: 6 } })[0].minHeight).toBe(6)
    expect(applyHeights([raised], { 'way/1': { height: 3 } })[0].minHeight).toBe(0)
  })

  it('does nothing without overrides', () => {
    const list = [a, b]
    expect(applyHeights(list, undefined)).toBe(list)
  })

  it('overrides a part inside a merged selection and the selection follows', () => {
    const outline = make('way/10', rect(0, 0, 20, 10), { 'addr:street': 'X', 'addr:housenumber': '1' })
    const tower = make('way/11', rect(0, 0, 8, 10), { 'building:part': 'yes', height: '30' })
    const wing = make('way/12', rect(8, 0, 20, 10), { 'building:part': 'yes', height: '12' })
    const all = [outline, tower, wing]
    const selected = mergeSelection(all, outline)
    expect(selected.height).toBe(30)
    const next = applyHeights(all, { 'way/12': { height: 45, levels: 15 } })
    const again = reselect(next, selected)
    expect(again).toMatchObject({ id: selected.id, height: 45, levels: 15, heightSource: 'user' })
    expect([...again.sources!].sort()).toEqual([...selected.sources!].sort())
    expect(again.members!.find((m) => m.id === 'way/12')!.height).toBe(45)
    expect(levelCount(again)).toBe(15)
  })

  it('reselects a lone polygon with its override', () => {
    const [x] = applyHeights([a], { 'way/1': { height: 15 } })
    expect(reselect([x], a).height).toBe(15)
  })
})

describe('units', () => {
  const b = make('way/1', rect(0, 0, 10, 10), { min_height: '3', height: '12' })
  it('turns floors into metres from where the building starts', () => {
    expect(overrideFor(b, 4, 'floors')).toEqual({ height: 15, levels: 4 })
    expect(overrideFor(b, 20.5, 'm')).toEqual({ height: 20.5 })
  })
  it('shows the building in either unit', () => {
    expect(heightIn(b, 'm')).toBe(12)
    expect(heightIn(b, 'floors')).toBe(3)
    expect(heightIn({ ...b, levels: 5 }, 'floors')).toBe(5)
  })
  it('accepts only sane numbers', () => {
    expect(validHeight(3, 'floors')).toBe(true)
    expect(validHeight(2.5, 'floors')).toBe(false)
    expect(validHeight(0, 'm')).toBe(false)
    expect(validHeight(NaN, 'm')).toBe(false)
    expect(validHeight(9999, 'm')).toBe(false)
  })
})

describe('building line source', () => {
  const b = make('way/1', rect(0, 0, 10, 10))
  it('says a default is guessed, a user height is yours, and data says nothing', () => {
    expect(buildingLine(b).source).toBe('height guessed: 9 m default')
    expect(buildingLine({ ...b, heightSource: 'tag' }).source).toBeNull()
    const [mine] = applyHeights([b], { 'way/1': { height: 18 } })
    const line = buildingLine(mine)
    expect(line.source).toBe('height set by you')
    expect(line.heightNote).toContain('the data had 9.0 m')
  })
})

describe('heights in a plan', () => {
  const b = make('way/1', rect(0, 0, 10, 10), { 'building:levels': '3' })
  const withHeights = { ...defaultPlan(b, O), heights: { 'way/2': { height: 24, levels: 8 }, 'way/3': { height: 30 } } }

  it('round-trips through JSON validation', () => {
    const result = validatePlan(JSON.parse(JSON.stringify(withHeights)))
    expect('plan' in result && result.plan.heights).toEqual(withHeights.heights)
  })

  it('loads an old plan without heights', () => {
    const result = validatePlan(JSON.parse(JSON.stringify(defaultPlan(b, O))))
    expect('plan' in result).toBe(true)
    expect('plan' in result && result.plan.heights).toBeUndefined()
  })

  it('survives a rebase to another origin unchanged', () => {
    const moved = rebasePlan(withHeights, { lat: 45.001, lon: 9.001 })
    expect(moved.origin.lat).toBe(45.001)
    expect(moved.heights).toEqual(withHeights.heights)
  })

  it('drops unusable entries instead of rejecting the plan', () => {
    const dirty = { ...withHeights, heights: { 'way/2': { height: -4 }, 'way/3': { height: 30, levels: 2.5, minHeight: 50 }, 'way/4': 'x' } }
    const result = validatePlan(dirty)
    expect('plan' in result && result.plan.heights).toEqual({ 'way/3': { height: 30 } })
    expect(parseHeights([1])).toBeUndefined()
  })

  it('keeps only the overrides of polygons that exist', () => {
    const known = keepKnown({ 'way/1': { height: 5 }, 'way/9': { height: 7 } }, [b])
    expect(known).toEqual({ 'way/1': { height: 5 } })
    expect(keepKnown({ 'way/9': { height: 7 } }, [b])).toBeUndefined()
  })
})
