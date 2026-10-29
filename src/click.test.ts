import { describe, expect, it } from 'vitest'
import { CLICK_MAX_MOVE_PX, isClick } from './click'

describe('isClick', () => {
  it('accepts a press and release at the same place or a few pixels apart', () => {
    expect(isClick({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe(true)
    expect(isClick({ x: 10, y: 10 }, { x: 13, y: 14 })).toBe(true)
  })

  it('rejects a drag', () => {
    expect(isClick({ x: 10, y: 10 }, { x: 10 + CLICK_MAX_MOVE_PX + 1, y: 10 })).toBe(false)
    expect(isClick({ x: 0, y: 0 }, { x: 40, y: 30 })).toBe(false)
  })

  it('counts a release without a recorded press as a click', () => {
    expect(isClick(undefined, { x: 5, y: 5 })).toBe(true)
  })
})
