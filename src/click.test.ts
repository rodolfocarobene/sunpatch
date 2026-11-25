import { describe, expect, it } from 'vitest'
import { CLICK_MAX_MOVE_PX, createPressTracker, isClick } from './click'

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

describe('createPressTracker', () => {
  it('remembers where a single press began', () => {
    const press = createPressTracker()
    press.down(1, 20, 30)
    expect(press.start).toEqual({ x: 20, y: 30 })
    press.up(1)
    expect(isClick(press.start, { x: 22, y: 31 })).toBe(true)
  })

  it('never counts a second finger as part of a click', () => {
    const press = createPressTracker()
    press.down(1, 20, 30)
    press.down(2, 60, 30)
    press.up(2)
    press.up(1)
    expect(isClick(press.start, { x: 20, y: 30 })).toBe(false)
  })

  it('starts afresh after every pointer is up or on reset', () => {
    const press = createPressTracker()
    press.down(1, 0, 0)
    press.down(2, 9, 9)
    press.up(1)
    press.up(2)
    press.down(3, 5, 6)
    expect(press.start).toEqual({ x: 5, y: 6 })
    press.down(4, 1, 1)
    press.reset()
    press.down(5, 7, 8)
    expect(press.start).toEqual({ x: 7, y: 8 })
  })
})
