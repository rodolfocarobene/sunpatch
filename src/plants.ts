// A small catalogue of common plants for a balcony, windowsill or small garden, with what each needs from the sun and
// the air. Figures are rounded values from general horticultural guidance (RHS, extension services, seed companies), written
// from general knowledge and not checked plant by plant; they describe a typical variety, not every cultivar.

export type PlantKind = 'vegetable' | 'fruit' | 'herb' | 'flower' | 'houseplant'
export type SunClass = 'full sun' | 'part sun' | 'part shade' | 'shade'

export interface Plant {
  id: string
  name: string
  kind: PlantKind
  indoor: boolean
  outdoor: boolean
  /** Hours of direct sun a day: the least it lives with, the amount it does best with, and a limit above which it scorches. */
  sun: { min: number; ideal: number; max?: number }
  /** Air temperature, degC: growth stops below `min` or above `max`, `optLow`..`optHigh` is where it does best, and `survive` is the coldest it lasts through. */
  temp: { min: number; optLow: number; optHigh: number; max: number; survive: number }
  life: 'annual' | 'perennial'
  /** Annual crops: days from sowing or planting out to the first harvest (or flowers). */
  days?: number
  source: string
}

/** Conventional classes by the sun a plant does best with: full >= 6 h, part sun 3-6 h, part shade 2-3 h, shade < 2 h. */
export function sunClass(plant: Plant): SunClass {
  const h = plant.sun.ideal
  return h >= 6 ? 'full sun' : h >= 3 ? 'part sun' : h >= 2 ? 'part shade' : 'shade'
}

const GUIDE = 'General horticultural guidance (RHS, extension services, seed companies); typical values, not checked per plant'

export const PLANTS: Plant[] = [
  { id: 'tomato', name: 'tomato', kind: 'vegetable', indoor: false, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 10, optLow: 20, optHigh: 27, max: 35, survive: 0 }, life: 'annual', days: 80, source: GUIDE },
  { id: 'lettuce', name: 'lettuce', kind: 'vegetable', indoor: true, outdoor: true, sun: { min: 3, ideal: 4 }, temp: { min: 5, optLow: 12, optHigh: 18, max: 26, survive: -5 }, life: 'annual', days: 50, source: GUIDE },
  { id: 'chard', name: 'chard', kind: 'vegetable', indoor: false, outdoor: true, sun: { min: 3, ideal: 4 }, temp: { min: 5, optLow: 15, optHigh: 24, max: 32, survive: -5 }, life: 'annual', days: 60, source: GUIDE },
  { id: 'courgette', name: 'courgette', kind: 'vegetable', indoor: false, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 12, optLow: 18, optHigh: 27, max: 35, survive: 0 }, life: 'annual', days: 55, source: GUIDE },
  { id: 'pepper', name: 'pepper', kind: 'vegetable', indoor: true, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 15, optLow: 21, optHigh: 29, max: 35, survive: 2 }, life: 'annual', days: 90, source: GUIDE },
  { id: 'radish', name: 'radish', kind: 'vegetable', indoor: false, outdoor: true, sun: { min: 3, ideal: 4 }, temp: { min: 5, optLow: 10, optHigh: 20, max: 28, survive: -3 }, life: 'annual', days: 30, source: GUIDE },
  { id: 'spinach', name: 'spinach', kind: 'vegetable', indoor: false, outdoor: true, sun: { min: 3, ideal: 4 }, temp: { min: 4, optLow: 10, optHigh: 18, max: 25, survive: -9 }, life: 'annual', days: 45, source: GUIDE },
  { id: 'bean', name: 'dwarf bean', kind: 'vegetable', indoor: false, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 12, optLow: 18, optHigh: 27, max: 32, survive: 0 }, life: 'annual', days: 60, source: GUIDE },
  { id: 'pea', name: 'pea', kind: 'vegetable', indoor: false, outdoor: true, sun: { min: 4, ideal: 6 }, temp: { min: 5, optLow: 13, optHigh: 18, max: 27, survive: -5 }, life: 'annual', days: 80, source: GUIDE },
  { id: 'carrot', name: 'carrot', kind: 'vegetable', indoor: false, outdoor: true, sun: { min: 4, ideal: 6 }, temp: { min: 7, optLow: 15, optHigh: 21, max: 30, survive: -5 }, life: 'annual', days: 80, source: GUIDE },
  { id: 'kale', name: 'kale', kind: 'vegetable', indoor: false, outdoor: true, sun: { min: 3, ideal: 4 }, temp: { min: 5, optLow: 10, optHigh: 21, max: 30, survive: -10 }, life: 'annual', days: 60, source: GUIDE },
  { id: 'rocket', name: 'rocket', kind: 'vegetable', indoor: true, outdoor: true, sun: { min: 3, ideal: 4 }, temp: { min: 5, optLow: 10, optHigh: 20, max: 28, survive: -3 }, life: 'annual', days: 35, source: GUIDE },
  { id: 'strawberry', name: 'strawberry', kind: 'fruit', indoor: false, outdoor: true, sun: { min: 5, ideal: 6 }, temp: { min: 5, optLow: 15, optHigh: 25, max: 32, survive: -10 }, life: 'perennial', source: GUIDE },

  { id: 'basil', name: 'basil', kind: 'herb', indoor: true, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 12, optLow: 20, optHigh: 28, max: 35, survive: 2 }, life: 'annual', days: 50, source: GUIDE },
  { id: 'parsley', name: 'parsley', kind: 'herb', indoor: true, outdoor: true, sun: { min: 3, ideal: 4 }, temp: { min: 5, optLow: 15, optHigh: 22, max: 30, survive: -10 }, life: 'perennial', source: `${GUIDE}; biennial, usually renewed yearly` },
  { id: 'rosemary', name: 'rosemary', kind: 'herb', indoor: true, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 10, optLow: 18, optHigh: 28, max: 38, survive: -7 }, life: 'perennial', source: GUIDE },
  { id: 'mint', name: 'mint', kind: 'herb', indoor: true, outdoor: true, sun: { min: 2, ideal: 4 }, temp: { min: 8, optLow: 15, optHigh: 25, max: 32, survive: -15 }, life: 'perennial', source: GUIDE },
  { id: 'thyme', name: 'thyme', kind: 'herb', indoor: true, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 8, optLow: 18, optHigh: 27, max: 35, survive: -12 }, life: 'perennial', source: GUIDE },
  { id: 'chives', name: 'chives', kind: 'herb', indoor: true, outdoor: true, sun: { min: 4, ideal: 6 }, temp: { min: 5, optLow: 15, optHigh: 24, max: 32, survive: -20 }, life: 'perennial', source: GUIDE },
  { id: 'sage', name: 'sage', kind: 'herb', indoor: false, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 8, optLow: 18, optHigh: 27, max: 35, survive: -10 }, life: 'perennial', source: GUIDE },
  { id: 'oregano', name: 'oregano', kind: 'herb', indoor: false, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 8, optLow: 18, optHigh: 27, max: 35, survive: -12 }, life: 'perennial', source: GUIDE },
  { id: 'coriander', name: 'coriander', kind: 'herb', indoor: true, outdoor: true, sun: { min: 3, ideal: 4 }, temp: { min: 7, optLow: 15, optHigh: 22, max: 28, survive: -3 }, life: 'annual', days: 45, source: GUIDE },

  { id: 'marigold', name: 'French marigold', kind: 'flower', indoor: false, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 10, optLow: 18, optHigh: 27, max: 35, survive: 0 }, life: 'annual', days: 60, source: GUIDE },
  { id: 'geranium', name: 'geranium (pelargonium)', kind: 'flower', indoor: true, outdoor: true, sun: { min: 5, ideal: 6 }, temp: { min: 10, optLow: 18, optHigh: 25, max: 35, survive: 2 }, life: 'perennial', source: GUIDE },
  { id: 'nasturtium', name: 'nasturtium', kind: 'flower', indoor: false, outdoor: true, sun: { min: 4, ideal: 6 }, temp: { min: 10, optLow: 15, optHigh: 24, max: 32, survive: 0 }, life: 'annual', days: 55, source: GUIDE },
  { id: 'lavender', name: 'lavender', kind: 'flower', indoor: false, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 5, optLow: 15, optHigh: 28, max: 38, survive: -12 }, life: 'perennial', source: GUIDE },
  { id: 'pansy', name: 'pansy', kind: 'flower', indoor: false, outdoor: true, sun: { min: 3, ideal: 4 }, temp: { min: 3, optLow: 10, optHigh: 18, max: 26, survive: -10 }, life: 'perennial', source: GUIDE },

  { id: 'pothos', name: 'pothos', kind: 'houseplant', indoor: true, outdoor: false, sun: { min: 0, ideal: 1, max: 3 }, temp: { min: 15, optLow: 18, optHigh: 27, max: 32, survive: 10 }, life: 'perennial', source: `${GUIDE}; bright indirect light assumed` },
  { id: 'snake-plant', name: 'snake plant', kind: 'houseplant', indoor: true, outdoor: false, sun: { min: 0, ideal: 2 }, temp: { min: 10, optLow: 18, optHigh: 27, max: 35, survive: 5 }, life: 'perennial', source: `${GUIDE}; copes with low light` },
  { id: 'fern', name: 'Boston fern', kind: 'houseplant', indoor: true, outdoor: false, sun: { min: 0, ideal: 1, max: 2 }, temp: { min: 15, optLow: 18, optHigh: 24, max: 30, survive: 10 }, life: 'perennial', source: `${GUIDE}; bright indirect light assumed` },
  { id: 'spider-plant', name: 'spider plant', kind: 'houseplant', indoor: true, outdoor: false, sun: { min: 0, ideal: 2, max: 4 }, temp: { min: 10, optLow: 18, optHigh: 27, max: 32, survive: 5 }, life: 'perennial', source: GUIDE },
  { id: 'aloe', name: 'aloe vera', kind: 'houseplant', indoor: true, outdoor: true, sun: { min: 4, ideal: 6 }, temp: { min: 10, optLow: 18, optHigh: 27, max: 38, survive: 4 }, life: 'perennial', source: GUIDE },
]

export const plantById = (id: string): Plant | undefined => PLANTS.find((p) => p.id === id)
