import { describe, expect, it } from 'vitest'
import { menuCorner, popoverTop } from './popover-place'

describe('popoverTop', () => {
  it('goes above the point when it fits', () => expect(popoverTop(400, 100, 18, 8, 800)).toBe(282))
  it('goes below when there is no room above', () => expect(popoverTop(60, 100, 18, 8, 800)).toBe(78))
  it('flips up when below would run into the docked bar', () => expect(popoverTop(700, 120, 18, 8, 760)).toBe(562))
  it('is pushed into the free band when neither side fits', () => expect(popoverTop(150, 300, 18, 100, 420)).toBe(100))
})

describe('menuCorner', () => {
  it('opens at the pointer when it fits', () => expect(menuCorner(100, 200, 8, 800)).toBe(100))
  it('flips to end at the pointer near the far edge', () => expect(menuCorner(700, 200, 8, 800)).toBe(500))
  it('is pushed inside when neither side fits', () => expect(menuCorner(150, 300, 8, 400)).toBe(100))
  it('never starts before the near edge', () => expect(menuCorner(50, 500, 8, 400)).toBe(8))
})
