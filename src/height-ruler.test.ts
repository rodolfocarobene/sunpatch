import { describe, expect, it } from 'vitest'
import { heightFromDrag, keyHeight, overrideFromRuler, rulerLabel, snapHeight } from './height-ruler'
import type { Building } from './osm'

const building = { id: 'way/1', minHeight: 0, height: 9, heightSource: 'default', outer: [], holes: [], tags: {} } as unknown as Building

describe('snapHeight', () => {
  it('snaps to whole floors, at least one', () => {
    expect(snapHeight(10.4, 0, false)).toBe(9)
    expect(snapHeight(10.6, 0, false)).toBe(12)
    expect(snapHeight(-5, 0, false)).toBe(3)
  })
  it('counts floors from where the building starts', () => {
    expect(snapHeight(10, 4, false)).toBe(10)
    expect(snapHeight(5, 4, false)).toBe(7)
  })
  it('snaps to 0.5 m with fine steps, at least 0.5 m above the start', () => {
    expect(snapHeight(10.3, 0, true)).toBe(10.5)
    expect(snapHeight(10.2, 0, true)).toBe(10)
    expect(snapHeight(0, 0, true)).toBe(0.5)
  })
  it('stops at the largest height and floor count', () => {
    expect(snapHeight(5000, 0, false)).toBeLessThanOrEqual(450)
    expect(snapHeight(5000, 0, true)).toBe(500)
  })
})

describe('heightFromDrag', () => {
  it('goes up with the pointer, a floor per 3 m of screen size', () => {
    expect(heightFromDrag(9, 0, 30, 5, false)).toBe(15)
    expect(heightFromDrag(9, 0, -30, 5, false)).toBe(3)
  })
  it('stays put without a usable scale', () => {
    expect(heightFromDrag(9, 0, 30, 0, false)).toBe(9)
  })
  it('moves in 0.5 m steps with Shift', () => {
    expect(heightFromDrag(9, 0, 2, 4, true)).toBe(9.5)
  })
})

describe('rulerLabel', () => {
  it('names floors and metres', () => {
    expect(rulerLabel(24, 0)).toBe('8 floors · 24 m')
    expect(rulerLabel(3, 0)).toBe('1 floor · 3 m')
    expect(rulerLabel(25.5, 0)).toBe('8.5 floors · 25.5 m')
    expect(rulerLabel(10, 4)).toBe('2 floors · 10 m')
  })
})

describe('overrideFromRuler', () => {
  it('stores whole floors as floors and half metres as metres', () => {
    expect(overrideFromRuler(building, 24)).toEqual({ height: 24, levels: 8 })
    expect(overrideFromRuler(building, 10.5)).toEqual({ height: 10.5 })
  })
})

describe('keyHeight', () => {
  it('moves one whole floor, snapping from between floors', () => {
    expect(keyHeight(9, 0, 1, false)).toBe(12)
    expect(keyHeight(9, 0, -1, false)).toBe(6)
    expect(keyHeight(10, 0, 1, false)).toBe(12)
    expect(keyHeight(10, 0, -1, false)).toBe(9)
  })
  it('never goes below one floor', () => {
    expect(keyHeight(3, 0, -1, false)).toBe(3)
    expect(keyHeight(7, 4, -1, false)).toBe(7)
  })
  it('moves 0.5 m with Shift, at least 0.5 m above the start', () => {
    expect(keyHeight(9, 0, 1, true)).toBe(9.5)
    expect(keyHeight(9, 0, -1, true)).toBe(8.5)
    expect(keyHeight(0.5, 0, -1, true)).toBe(0.5)
  })
})
