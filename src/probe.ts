/**
 * What the Esc key does: a first press closes an open card (the Garden's plant or spot card), then an open popover, and
 * only then does a press leave walk mode.
 */
export function escapeAction(state: { walking: boolean; popoverOpen: boolean; cardOpen?: boolean }): 'close-card' | 'close-popover' | 'exit-walk' | 'none' {
  if (state.cardOpen) return 'close-card'
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
