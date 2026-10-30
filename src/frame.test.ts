import { describe, expect, it } from 'vitest'
import { fitDistance, freeAspect, metresPerPixel } from './frame'

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
