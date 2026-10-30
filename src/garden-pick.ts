import { t } from './i18n'

// What a click in the Garden view means: indoors on the apartment floor, outdoors on the ground or on a roof, or a
// surface where nothing can stand (a facade, a ceiling).

export type PickedKind = 'indoor' | 'ground' | 'roof'

export interface SurfaceHit {
  /** Scene height of the point hit, metres. */
  y: number
  /** The apartment's own floor, inside its outline. */
  apartmentFloor: boolean
  /** Height component of the surface normal: 1 faces up, 0 is a wall, -1 faces down. */
  normalY: number
  /** With the floors above hidden: the cut through the selected building (the top of its visible storey), not its roof. */
  cut?: boolean
}

/** What a click means: a spot kind, or the cut through the building (no spot). */
export type HitKind = PickedKind | 'cut'

/** Surfaces tilted less than about 45 degrees from flat count as ones a pot can stand on. */
export const FLAT_ENOUGH = 0.7
/** Up to this height a flat surface is the ground (the scene's ground is level at 0); above it, a roof or terrace. */
export const GROUND_TOP = 0.5

/**
 * The spot a click makes. The apartment floor is indoors. Any other upward surface is outdoors: the ground when it is
 * at ground level, else a roof, terrace or balcony. Walls (facades) and surfaces facing down give nothing: the caller
 * asks for a floor, ground or roof spot instead of guessing which ground the click was meant for. The cut surface of
 * a building whose upper floors are hidden is no roof: it is reported as 'cut'.
 */
export function classifyHit(hit: SurfaceHit): HitKind | null {
  if (hit.apartmentFloor) return 'indoor'
  if (hit.normalY < FLAT_ENOUGH) return null
  if (hit.cut) return 'cut'
  return hit.y <= GROUND_TOP ? 'ground' : 'roof'
}

export const FACADE_HINT = t('garden.facade')

export const CUT_HINT = t('garden.cut')
