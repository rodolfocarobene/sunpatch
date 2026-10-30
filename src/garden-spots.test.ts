import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/overpass-milan-duomo.json'
import { buildExample } from './example'
import { GROUND_CAP, INDOOR_CAP, INDOOR_CELL, POT_HEIGHT, ROOF_CAP, gardenSpots, groundSpots, indoorSpots, pointSpot, roofSpots, spotPoints, withSun } from './garden-spots'
import type { OverpassElement } from './osm'
import { floorBase } from './plan'

const { buildings, selected, plan, origin } = buildExample(fixture.elements as unknown as OverpassElement[])

describe('garden spots', () => {
  it('puts indoor spots on the floor grid at pot height above the storey', () => {
    const spots = indoorSpots(selected, plan)
    expect(spots.length).toBeGreaterThan(100)
    expect(spots.length).toBeLessThanOrEqual(INDOOR_CAP)
    // 12 x 10 m minus walls: fewer cells than the whole rectangle
    expect(spots.length).toBeLessThan(120 / (INDOOR_CELL * INDOOR_CELL))
    for (const s of spots) {
      expect(s.indoor).toBe(true)
      expect(s.kind).toBe('indoor')
      expect(s.y).toBeCloseTo(floorBase(selected, plan) + POT_HEIGHT)
    }
  })

  it('puts ground spots at pot height above the ground, outside, within the cap', () => {
    const spots = groundSpots(selected, buildings, origin.lat)
    expect(spots.length).toBeGreaterThan(50)
    expect(spots.length).toBeLessThanOrEqual(GROUND_CAP)
    for (const s of spots) {
      expect(s.indoor).toBe(false)
      expect(s.kind).toBe('ground')
      expect(s.y).toBeCloseTo(POT_HEIGHT)
    }
  })

  it('puts roof spots at pot height above the roof', () => {
    const spots = roofSpots(selected, origin.lat)
    expect(spots.length).toBeGreaterThan(50)
    expect(spots.length).toBeLessThanOrEqual(ROOF_CAP)
    for (const s of spots) {
      expect(s.indoor).toBe(false)
      expect(s.kind).toBe('roof')
      expect(s.y).toBeGreaterThan(selected.minHeight + POT_HEIGHT)
    }
  })

  it('has no indoor spots without a plan, and a bounded total', () => {
    const all = gardenSpots(selected, buildings, plan, origin.lat)
    expect(all.length).toBeLessThanOrEqual(INDOOR_CAP + GROUND_CAP + ROOF_CAP)
    expect(all.some((s) => s.indoor)).toBe(true)
    expect(gardenSpots(selected, buildings, undefined, origin.lat).some((s) => s.indoor)).toBe(false)
  })

  it('makes one spot for a clicked point', () => {
    expect(pointSpot(1, 3, 2, true)).toEqual({ x: 1, y: 3 + POT_HEIGHT, z: 2, indoor: true, kind: 'point' })
    expect(pointSpot(1, 0, 2, false).indoor).toBe(false)
  })

  it('flattens spots for tracing and joins them with their minutes', () => {
    const spots = [pointSpot(1, 0, 2, false), pointSpot(3, 0, 4, true)]
    expect(Array.from(spotPoints(spots))).toEqual([1, POT_HEIGHT, 2, 3, POT_HEIGHT, 4].map((v) => Math.fround(v)))
    const minutes = new Float32Array(24).map((_, i) => i)
    const joined = withSun(spots, minutes)
    expect(joined[1].sunMinutes).toEqual([12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23])
    expect(joined[1].indoor).toBe(true)
  })
})
