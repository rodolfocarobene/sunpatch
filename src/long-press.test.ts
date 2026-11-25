import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLongPress, LONG_PRESS_MOVE_PX, LONG_PRESS_MS } from './long-press'

const touch = (pointerId: number, clientX: number, clientY: number) => ({ pointerId, pointerType: 'touch', clientX, clientY })

function setup() {
  vi.useFakeTimers()
  const fire = vi.fn()
  return { fire, press: createLongPress(fire) }
}

describe('createLongPress', () => {
  afterEach(() => vi.useRealTimers())

  it('fires once where a finger is held still', () => {
    const { fire, press } = setup()
    press.down(touch(1, 40, 50))
    vi.advanceTimersByTime(LONG_PRESS_MS - 1)
    expect(fire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fire).toHaveBeenCalledWith({ x: 40, y: 50 })
    vi.advanceTimersByTime(LONG_PRESS_MS)
    expect(fire).toHaveBeenCalledTimes(1)
  })

  it('lets a small wobble through but cancels on a drag', () => {
    const { fire, press } = setup()
    press.down(touch(1, 0, 0))
    press.move(touch(1, LONG_PRESS_MOVE_PX - 2, 0))
    vi.advanceTimersByTime(LONG_PRESS_MS)
    expect(fire).toHaveBeenCalledTimes(1)
    press.up(touch(1, 0, 0))
    press.down(touch(2, 0, 0))
    press.move(touch(2, LONG_PRESS_MOVE_PX + 1, 0))
    vi.advanceTimersByTime(LONG_PRESS_MS)
    expect(fire).toHaveBeenCalledTimes(1)
  })

  it('cancels on a lift before the time and on a second finger', () => {
    const { fire, press } = setup()
    press.down(touch(1, 0, 0))
    vi.advanceTimersByTime(LONG_PRESS_MS / 2)
    press.up(touch(1, 0, 0))
    press.down(touch(2, 0, 0))
    press.down(touch(3, 30, 0))
    vi.advanceTimersByTime(LONG_PRESS_MS * 2)
    expect(fire).not.toHaveBeenCalled()
  })

  it('ignores the mouse and the pen', () => {
    const { fire, press } = setup()
    press.down({ pointerId: 1, pointerType: 'mouse', clientX: 0, clientY: 0 })
    vi.advanceTimersByTime(LONG_PRESS_MS)
    expect(fire).not.toHaveBeenCalled()
    expect(press.touching).toBe(false)
  })

  it('eats the one click that follows a long press', () => {
    const { press } = setup()
    press.down(touch(1, 0, 0))
    expect(press.touching).toBe(true)
    vi.advanceTimersByTime(LONG_PRESS_MS)
    press.up(touch(1, 0, 0))
    expect(press.touching).toBe(false)
    expect(press.takeClick()).toBe(true)
    expect(press.takeClick()).toBe(false)
  })

  it('does not eat a tap', () => {
    const { press } = setup()
    press.down(touch(1, 0, 0))
    press.up(touch(1, 0, 0))
    expect(press.takeClick()).toBe(false)
  })
})
