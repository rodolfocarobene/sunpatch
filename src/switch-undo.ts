import type { View } from './ui'
import { t } from './i18n'

/** What a plain scene click on another building does: Garden reads it as a spot, Panels with the suitability map on only explains. */
export type BuildingClick = 'switch' | 'explain' | 'ignore'

export function buildingClickAction(view: View, suitabilityOn: boolean): BuildingClick {
  if (view === 'garden') return 'ignore'
  if (view === 'panels' && suitabilityOn) return 'explain'
  return 'switch'
}

export const NEIGHBOUR_NOTE = t('shell.neighbourNote')

/** One level of undo: the state to come back to after a switch; a newer switch replaces it, using it (or a dismiss) empties it. */
export interface UndoSlot<T> {
  set(state: T): void
  take(): T | undefined
  clear(): void
  readonly has: boolean
}

export function createUndoSlot<T>(): UndoSlot<T> {
  let held: T | undefined
  return {
    set: (state) => void (held = state),
    take() {
      const state = held
      held = undefined
      return state
    },
    clear: () => void (held = undefined),
    get has() {
      return held !== undefined
    },
  }
}
