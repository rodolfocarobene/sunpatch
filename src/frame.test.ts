import { describe, expect, it } from 'vitest'
import { fitDistance, freeAspect, gardenRadius, GARDEN_MARGIN, inFreeArea, metresPerPixel } from './frame'

describe('fitDistance', () => {
  it('makes the circle cover the fill share of the smaller side', () => {
    const d = fitDistance(10, 50, 1.5, 0.5)
    // Visible half-height at that distance is radius / fill.
    expect(d * Math.tan((50 * Math.PI) / 360)).toBeCloseTo(20, 6)
  })

  it('backs off when the free area is narrower than tall', () => {
    expect(fitDistance(10, 50, 0.5)).toBeGreaterThan(fitDistance(10, 50, 1.5))
  })

  it('does not depend on the width once the area is wider than tall', () => {
    expect(fitDistance(10, 50, 1.2)).toBeCloseTo(fitDistance(10, 50, 3), 9)
  })
})

describe('freeAspect and metresPerPixel', () => {
  it('leaves out the panel', () => {
    expect(freeAspect(1440, 900, 340)).toBeCloseTo(1100 / 900, 9)
  })

  it('scales with distance', () => {
    expect(metresPerPixel(60, 50, 900)).toBeCloseTo(2 * metresPerPixel(30, 50, 900), 9)
  })
})

describe('gardenRadius', () => {
  it('holds the apartment, the building and a margin of ground', () => {
    expect(gardenRadius(8, 12)).toBe(12 + GARDEN_MARGIN)
    expect(gardenRadius(8, 5)).toBe(8 + GARDEN_MARGIN)
  })
  it('stops growing with a very large building', () => {
    expect(gardenRadius(8, 200)).toBe(8 * 1.8 + 3 + GARDEN_MARGIN)
  })
  it('grows to hold the roof when the floors above are shown', () => {
    expect(gardenRadius(8, 12, 20)).toBeGreaterThan(gardenRadius(8, 12))
    expect(gardenRadius(8, 12, 0)).toBe(12 + GARDEN_MARGIN)
  })
})

describe('inFreeArea', () => {
  it('is true in the middle of what the panel leaves free', () => {
    expect(inFreeArea(800, 450, 1440, 900, 330)).toBe(true)
  })
  it('is false under the panel, near an edge or off screen', () => {
    expect(inFreeArea(200, 450, 1440, 900, 330)).toBe(false)
    expect(inFreeArea(800, 890, 1440, 900, 330)).toBe(false)
    expect(inFreeArea(-5, 450, 1440, 900, 330)).toBe(false)
  })
})
