/** What the Esc key does: a first press closes an open popover, the next one leaves walk mode. */
export function escapeAction(state: { walking: boolean; popoverOpen: boolean }): 'close-popover' | 'exit-walk' | 'none' {
  if (state.popoverOpen) return 'close-popover'
  return state.walking ? 'exit-walk' : 'none'
}

/**
 * What a click on the floor does with the sun map: no result yet means the map is (about to be) computed, so the
 * spot waits for it; a spot outside the map's grid shows nothing and clears the mark.
 */
export function probeOutcome(hasResult: boolean, inGrid: boolean): 'wait' | 'show' | 'close' {
  if (!hasResult) return 'wait'
  return inGrid ? 'show' : 'close'
}
