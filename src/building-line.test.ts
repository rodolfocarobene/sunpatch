import { describe, expect, it } from 'vitest'
import { buildingLine } from './building-line'
import type { Building } from './osm'

const base: Building = { id: 'relation/36488', outer: [], holes: [], minHeight: 0, height: 9, heightSource: 'levels', levels: 3, tags: {} }

describe('buildingLine', () => {
  it('names the object, its height and levels', () => {
    const line = buildingLine(base)
    expect(line.label).toBe('OpenStreetMap')
    expect(line.osmId).toBe('Relation 36488')
    expect(line.href).toBe('https://www.openstreetmap.org/relation/36488')
    expect(line.facts).toEqual(['9 m', '3 levels'])
    expect(line.title).toBeNull()
  })
  it('uses the singular, skips unknown levels and keeps one decimal', () => {
    expect(buildingLine({ ...base, levels: 1 }).facts).toEqual(['9 m', '1 level'])
    expect(buildingLine({ ...base, levels: undefined, height: 10.46 }).facts).toEqual(['10.5 m'])
  })
  it('prefers the name, then the street address', () => {
    expect(buildingLine({ ...base, tags: { name: 'Duomo', 'addr:street': 'Via X' } }).title).toBe('Duomo')
    expect(buildingLine({ ...base, tags: { 'addr:street': 'Via Roma', 'addr:housenumber': '4' } }).title).toBe('Via Roma 4')
  })
  it('counts the parts of a merged selection and drops the ring suffix from the link', () => {
    const line = buildingLine({ ...base, id: 'way/12#2', members: [base, base, base] })
    expect(line.facts[0]).toBe('3 parts')
    expect(line.href).toBe('https://www.openstreetmap.org/way/12')
  })
  it('has no link for a map-tile outline', () => {
    const line = buildingLine({ ...base, id: 'tile/9', heightSource: 'tile' })
    expect(line.label).toBe('Map-tile outline')
    expect(line.href).toBeNull()
    expect(line.osmId).toBeNull()
  })
})
