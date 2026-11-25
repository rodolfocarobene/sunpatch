import { FURNITURE, type FurnitureKind } from './furniture'
import type { PickedKind } from './garden-pick'

// What the scene's context menu (right-click, or a long press on a touch screen) offers for the thing under the pointer.

export type SceneMenuItem = 'rotate' | 'remove' | 'sun' | 'daylight' | 'plants' | 'addPlant' | 'addFurniture' | 'height'

export interface SceneMenuTarget {
  /** A point of the apartment floor: the floor itself, or the floor under a sill, a wall or a piece of furniture inside. */
  floor?: boolean
  /** Where a pot can stand (the Garden view's spot kinds); none on a facade, a ceiling, the sky or the cut through the building. */
  spot?: PickedKind
  /** A building polygon (not the inside of the apartment). */
  building?: boolean
  /** A piece of furniture or a pot. */
  furniture?: boolean
}

/**
 * The menu's groups, separated on screen: the piece under the pointer, the light at the point, what to put there, the
 * building. Sun and indirect light are the apartment floor's (the sun map and the daylight estimate cover only it); a pot
 * or a piece of furniture needs a plan to be saved in. A building's height is not offered from inside the apartment or
 * while walking (the height box needs the outside view).
 */
export function sceneMenuItems(target: SceneMenuTarget, state: { hasPlan: boolean; walking: boolean }): SceneMenuItem[][] {
  const floor = !!target.floor && state.hasPlan
  const groups: SceneMenuItem[][] = [
    target.furniture && state.hasPlan ? ['rotate', 'remove'] : [],
    floor ? ['sun', 'daylight'] : [],
    [
      ...(target.spot ? (['plants'] as const) : []),
      ...(target.spot && state.hasPlan ? (['addPlant'] as const) : []),
      ...(floor ? (['addFurniture'] as const) : []),
    ],
    target.building && !target.floor && !target.furniture && !state.walking ? ['height'] : [],
  ]
  return groups.filter((g) => g.length > 0)
}

/** A few common plants for the "Add a plant here" list, by where the pot stands (all of them grow there: see plants.ts). */
export const MENU_PLANTS: Record<'indoor' | 'outdoor', readonly string[]> = {
  indoor: ['basil', 'pothos', 'monstera', 'peace-lily', 'snake-plant'],
  outdoor: ['tomato', 'basil', 'rosemary', 'lavender', 'geranium'],
}

/** The furniture the menu can place: every kind but the plain plant (pots come from the plant list, named after their plant). */
export const MENU_FURNITURE: readonly FurnitureKind[] = FURNITURE.map((s) => s.kind).filter((k) => k !== 'plant')
