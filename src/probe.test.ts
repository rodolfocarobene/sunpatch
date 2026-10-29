import { describe, expect, it } from 'vitest'
import { escapeAction, probeOutcome } from './probe'

describe('escapeAction', () => {
  it('closes an open popover first, whether walking or not', () => {
    expect(escapeAction({ walking: true, popoverOpen: true })).toBe('close-popover')
    expect(escapeAction({ walking: false, popoverOpen: true })).toBe('close-popover')
  })
  it('leaves walk mode when no popover is open', () => {
    expect(escapeAction({ walking: true, popoverOpen: false })).toBe('exit-walk')
  })
  it('does nothing outside walk mode with no popover', () => {
    expect(escapeAction({ walking: false, popoverOpen: false })).toBe('none')
  })
  it('takes two presses to get out of walk mode with a popover open', () => {
    const state = { walking: true, popoverOpen: true }
    expect(escapeAction(state)).toBe('close-popover')
    state.popoverOpen = false
    expect(escapeAction(state)).toBe('exit-walk')
  })
})

describe('probeOutcome', () => {
  it('waits while the sun map has no result', () => {
    expect(probeOutcome(false, false)).toBe('wait')
    expect(probeOutcome(false, true)).toBe('wait')
  })
  it('shows spots inside the grid and closes for spots outside it', () => {
    expect(probeOutcome(true, true)).toBe('show')
    expect(probeOutcome(true, false)).toBe('close')
  })
})
