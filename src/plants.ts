// A small catalogue of common plants for a balcony, windowsill or small garden, with what each needs from the sun and
// the air. Figures are rounded values from general horticultural guidance (RHS, extension services, seed companies), written
// from general knowledge and not checked plant by plant; they describe a typical variety, not every cultivar.

export type PlantKind = 'vegetable' | 'fruit' | 'herb' | 'flower' | 'houseplant'
export type SunClass = 'full sun' | 'part sun' | 'part shade' | 'shade'

export interface Plant {
  id: string
  name: string
  /** Common Italian name. */
  nameIt: string
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
  { id: 'tomato', name: 'tomato', nameIt: 'pomodoro', kind: 'vegetable', indoor: false, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 10, optLow: 20, optHigh: 27, max: 35, survive: 0 }, life: 'annual', days: 80, source: GUIDE },
  { id: 'lettuce', name: 'lettuce', nameIt: 'lattuga', kind: 'vegetable', indoor: true, outdoor: true, sun: { min: 3, ideal: 4 }, temp: { min: 5, optLow: 12, optHigh: 18, max: 26, survive: -5 }, life: 'annual', days: 50, source: GUIDE },
  { id: 'chard', name: 'chard', nameIt: 'bietola', kind: 'vegetable', indoor: false, outdoor: true, sun: { min: 3, ideal: 4 }, temp: { min: 5, optLow: 15, optHigh: 24, max: 32, survive: -5 }, life: 'annual', days: 60, source: GUIDE },
  { id: 'courgette', name: 'courgette', nameIt: 'zucchina', kind: 'vegetable', indoor: false, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 12, optLow: 18, optHigh: 27, max: 35, survive: 0 }, life: 'annual', days: 55, source: GUIDE },
  { id: 'pepper', name: 'pepper', nameIt: 'peperone', kind: 'vegetable', indoor: true, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 15, optLow: 21, optHigh: 29, max: 35, survive: 2 }, life: 'annual', days: 90, source: GUIDE },
  { id: 'radish', name: 'radish', nameIt: 'ravanello', kind: 'vegetable', indoor: false, outdoor: true, sun: { min: 3, ideal: 4 }, temp: { min: 5, optLow: 10, optHigh: 20, max: 28, survive: -3 }, life: 'annual', days: 30, source: GUIDE },
  { id: 'spinach', name: 'spinach', nameIt: 'spinaci', kind: 'vegetable', indoor: false, outdoor: true, sun: { min: 3, ideal: 4 }, temp: { min: 4, optLow: 10, optHigh: 18, max: 25, survive: -9 }, life: 'annual', days: 45, source: GUIDE },
  { id: 'bean', name: 'dwarf bean', nameIt: 'fagiolino nano', kind: 'vegetable', indoor: false, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 12, optLow: 18, optHigh: 27, max: 32, survive: 0 }, life: 'annual', days: 60, source: GUIDE },
  { id: 'pea', name: 'pea', nameIt: 'pisello', kind: 'vegetable', indoor: false, outdoor: true, sun: { min: 4, ideal: 6 }, temp: { min: 5, optLow: 13, optHigh: 18, max: 27, survive: -5 }, life: 'annual', days: 80, source: GUIDE },
  { id: 'carrot', name: 'carrot', nameIt: 'carota', kind: 'vegetable', indoor: false, outdoor: true, sun: { min: 4, ideal: 6 }, temp: { min: 7, optLow: 15, optHigh: 21, max: 30, survive: -5 }, life: 'annual', days: 80, source: GUIDE },
  { id: 'kale', name: 'kale', nameIt: 'cavolo nero', kind: 'vegetable', indoor: false, outdoor: true, sun: { min: 3, ideal: 4 }, temp: { min: 5, optLow: 10, optHigh: 21, max: 30, survive: -10 }, life: 'annual', days: 60, source: GUIDE },
  { id: 'rocket', name: 'rocket', nameIt: 'rucola', kind: 'vegetable', indoor: true, outdoor: true, sun: { min: 3, ideal: 4 }, temp: { min: 5, optLow: 10, optHigh: 20, max: 28, survive: -3 }, life: 'annual', days: 35, source: GUIDE },
  { id: 'strawberry', name: 'strawberry', nameIt: 'fragola', kind: 'fruit', indoor: false, outdoor: true, sun: { min: 5, ideal: 6 }, temp: { min: 5, optLow: 15, optHigh: 25, max: 32, survive: -10 }, life: 'perennial', source: GUIDE },
  { id: 'aubergine', name: 'aubergine', nameIt: 'melanzana', kind: 'vegetable', indoor: false, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 15, optLow: 21, optHigh: 29, max: 35, survive: 2 }, life: 'annual', days: 110, source: GUIDE },
  { id: 'cucumber', name: 'cucumber', nameIt: 'cetriolo', kind: 'vegetable', indoor: false, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 15, optLow: 20, optHigh: 28, max: 35, survive: 2 }, life: 'annual', days: 60, source: GUIDE },
  { id: 'broad-bean', name: 'broad bean', nameIt: 'fava', kind: 'vegetable', indoor: false, outdoor: true, sun: { min: 4, ideal: 6 }, temp: { min: 3, optLow: 10, optHigh: 18, max: 27, survive: -8 }, life: 'annual', days: 120, source: `${GUIDE}; sown in autumn or late winter` },
  { id: 'onion', name: 'onion', nameIt: 'cipolla', kind: 'vegetable', indoor: false, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 7, optLow: 13, optHigh: 24, max: 32, survive: -7 }, life: 'annual', days: 120, source: `${GUIDE}; grown from sets` },
  { id: 'garlic', name: 'garlic', nameIt: 'aglio', kind: 'vegetable', indoor: false, outdoor: true, sun: { min: 5, ideal: 6 }, temp: { min: 4, optLow: 12, optHigh: 22, max: 30, survive: -15 }, life: 'annual', days: 200, source: `${GUIDE}; planted in autumn` },
  { id: 'leek', name: 'leek', nameIt: 'porro', kind: 'vegetable', indoor: false, outdoor: true, sun: { min: 4, ideal: 6 }, temp: { min: 5, optLow: 13, optHigh: 22, max: 30, survive: -15 }, life: 'annual', days: 130, source: GUIDE },
  { id: 'beetroot', name: 'beetroot', nameIt: 'barbabietola', kind: 'vegetable', indoor: false, outdoor: true, sun: { min: 4, ideal: 6 }, temp: { min: 5, optLow: 12, optHigh: 22, max: 30, survive: -5 }, life: 'annual', days: 60, source: GUIDE },
  { id: 'broccoli', name: 'broccoli', nameIt: 'broccolo', kind: 'vegetable', indoor: false, outdoor: true, sun: { min: 4, ideal: 6 }, temp: { min: 5, optLow: 13, optHigh: 20, max: 28, survive: -7 }, life: 'annual', days: 80, source: GUIDE },
  { id: 'fennel', name: 'Florence fennel', nameIt: 'finocchio', kind: 'vegetable', indoor: false, outdoor: true, sun: { min: 4, ideal: 6 }, temp: { min: 7, optLow: 15, optHigh: 20, max: 28, survive: -3 }, life: 'annual', days: 90, source: GUIDE },
  { id: 'potato', name: 'potato', nameIt: 'patata', kind: 'vegetable', indoor: false, outdoor: true, sun: { min: 5, ideal: 6 }, temp: { min: 7, optLow: 15, optHigh: 20, max: 28, survive: 0 }, life: 'annual', days: 100, source: `${GUIDE}; frost kills the tops` },
  { id: 'pumpkin', name: 'pumpkin', nameIt: 'zucca', kind: 'vegetable', indoor: false, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 12, optLow: 20, optHigh: 28, max: 35, survive: 0 }, life: 'annual', days: 110, source: `${GUIDE}; needs a large pot or ground` },
  { id: 'lambs-lettuce', name: "lamb's lettuce", nameIt: 'valerianella', kind: 'vegetable', indoor: false, outdoor: true, sun: { min: 3, ideal: 4 }, temp: { min: 3, optLow: 8, optHigh: 18, max: 25, survive: -15 }, life: 'annual', days: 60, source: GUIDE },
  { id: 'radicchio', name: 'radicchio', nameIt: 'radicchio', kind: 'vegetable', indoor: false, outdoor: true, sun: { min: 4, ideal: 6 }, temp: { min: 4, optLow: 12, optHigh: 20, max: 28, survive: -8 }, life: 'annual', days: 80, source: GUIDE },
  { id: 'runner-bean', name: 'runner bean', nameIt: 'fagiolo rampicante', kind: 'vegetable', indoor: false, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 12, optLow: 18, optHigh: 26, max: 32, survive: 0 }, life: 'annual', days: 70, source: `${GUIDE}; climbs, needs a support` },
  { id: 'melon', name: 'melon', nameIt: 'melone', kind: 'fruit', indoor: false, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 15, optLow: 22, optHigh: 30, max: 38, survive: 2 }, life: 'annual', days: 90, source: GUIDE },
  { id: 'blueberry', name: 'blueberry', nameIt: 'mirtillo', kind: 'fruit', indoor: false, outdoor: true, sun: { min: 5, ideal: 6 }, temp: { min: 5, optLow: 15, optHigh: 24, max: 32, survive: -20 }, life: 'perennial', source: `${GUIDE}; needs acid soil (ericaceous compost)` },
  { id: 'raspberry', name: 'raspberry', nameIt: 'lampone', kind: 'fruit', indoor: false, outdoor: true, sun: { min: 5, ideal: 6 }, temp: { min: 5, optLow: 15, optHigh: 24, max: 30, survive: -20 }, life: 'perennial', source: GUIDE },
  { id: 'lemon', name: 'lemon', nameIt: 'limone', kind: 'fruit', indoor: false, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 10, optLow: 18, optHigh: 28, max: 38, survive: -2 }, life: 'perennial', source: `${GUIDE}; in a pot; protect from frost and move indoors in winter` },
  { id: 'fig', name: 'fig', nameIt: 'fico', kind: 'fruit', indoor: false, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 8, optLow: 18, optHigh: 30, max: 38, survive: -12 }, life: 'perennial', source: `${GUIDE}; in a pot or the ground; young plants need frost protection` },

  { id: 'basil', name: 'basil', nameIt: 'basilico', kind: 'herb', indoor: true, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 12, optLow: 20, optHigh: 28, max: 35, survive: 2 }, life: 'annual', days: 50, source: GUIDE },
  { id: 'parsley', name: 'parsley', nameIt: 'prezzemolo', kind: 'herb', indoor: true, outdoor: true, sun: { min: 3, ideal: 4 }, temp: { min: 5, optLow: 15, optHigh: 22, max: 30, survive: -10 }, life: 'perennial', source: `${GUIDE}; biennial, usually renewed yearly` },
  { id: 'rosemary', name: 'rosemary', nameIt: 'rosmarino', kind: 'herb', indoor: true, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 10, optLow: 18, optHigh: 28, max: 38, survive: -7 }, life: 'perennial', source: GUIDE },
  { id: 'mint', name: 'mint', nameIt: 'menta', kind: 'herb', indoor: true, outdoor: true, sun: { min: 2, ideal: 4 }, temp: { min: 8, optLow: 15, optHigh: 25, max: 32, survive: -15 }, life: 'perennial', source: GUIDE },
  { id: 'thyme', name: 'thyme', nameIt: 'timo', kind: 'herb', indoor: true, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 8, optLow: 18, optHigh: 27, max: 35, survive: -12 }, life: 'perennial', source: GUIDE },
  { id: 'chives', name: 'chives', nameIt: 'erba cipollina', kind: 'herb', indoor: true, outdoor: true, sun: { min: 4, ideal: 6 }, temp: { min: 5, optLow: 15, optHigh: 24, max: 32, survive: -20 }, life: 'perennial', source: GUIDE },
  { id: 'sage', name: 'sage', nameIt: 'salvia', kind: 'herb', indoor: false, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 8, optLow: 18, optHigh: 27, max: 35, survive: -10 }, life: 'perennial', source: GUIDE },
  { id: 'oregano', name: 'oregano', nameIt: 'origano', kind: 'herb', indoor: false, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 8, optLow: 18, optHigh: 27, max: 35, survive: -12 }, life: 'perennial', source: GUIDE },
  { id: 'coriander', name: 'coriander', nameIt: 'coriandolo', kind: 'herb', indoor: true, outdoor: true, sun: { min: 3, ideal: 4 }, temp: { min: 7, optLow: 15, optHigh: 22, max: 28, survive: -3 }, life: 'annual', days: 45, source: GUIDE },
  { id: 'bay', name: 'bay laurel', nameIt: 'alloro', kind: 'herb', indoor: false, outdoor: true, sun: { min: 4, ideal: 6 }, temp: { min: 8, optLow: 15, optHigh: 25, max: 35, survive: -10 }, life: 'perennial', source: `${GUIDE}; slow growing; young plants need frost protection` },
  { id: 'dill', name: 'dill', nameIt: 'aneto', kind: 'herb', indoor: false, outdoor: true, sun: { min: 5, ideal: 6 }, temp: { min: 7, optLow: 15, optHigh: 22, max: 30, survive: -3 }, life: 'annual', days: 60, source: GUIDE },
  { id: 'lemon-balm', name: 'lemon balm', nameIt: 'melissa', kind: 'herb', indoor: true, outdoor: true, sun: { min: 3, ideal: 4 }, temp: { min: 8, optLow: 15, optHigh: 25, max: 32, survive: -20 }, life: 'perennial', source: GUIDE },
  { id: 'marjoram', name: 'marjoram', nameIt: 'maggiorana', kind: 'herb', indoor: false, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 10, optLow: 18, optHigh: 25, max: 32, survive: -5 }, life: 'perennial', source: `${GUIDE}; sweet marjoram, tender in cold winters` },
  { id: 'lemongrass', name: 'lemongrass', nameIt: 'citronella', kind: 'herb', indoor: true, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 15, optLow: 22, optHigh: 32, max: 38, survive: 2 }, life: 'perennial', source: `${GUIDE}; tender; bring indoors for winter` },

  { id: 'marigold', name: 'French marigold', nameIt: 'tagete', kind: 'flower', indoor: false, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 10, optLow: 18, optHigh: 27, max: 35, survive: 0 }, life: 'annual', days: 60, source: GUIDE },
  { id: 'geranium', name: 'geranium (pelargonium)', nameIt: 'geranio', kind: 'flower', indoor: true, outdoor: true, sun: { min: 5, ideal: 6 }, temp: { min: 10, optLow: 18, optHigh: 25, max: 35, survive: 2 }, life: 'perennial', source: GUIDE },
  { id: 'nasturtium', name: 'nasturtium', nameIt: 'nasturzio', kind: 'flower', indoor: false, outdoor: true, sun: { min: 4, ideal: 6 }, temp: { min: 10, optLow: 15, optHigh: 24, max: 32, survive: 0 }, life: 'annual', days: 55, source: GUIDE },
  { id: 'lavender', name: 'lavender', nameIt: 'lavanda', kind: 'flower', indoor: false, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 5, optLow: 15, optHigh: 28, max: 38, survive: -12 }, life: 'perennial', source: GUIDE },
  { id: 'pansy', name: 'pansy', nameIt: 'viola del pensiero', kind: 'flower', indoor: false, outdoor: true, sun: { min: 3, ideal: 4 }, temp: { min: 3, optLow: 10, optHigh: 18, max: 26, survive: -10 }, life: 'perennial', source: GUIDE },
  { id: 'petunia', name: 'petunia', nameIt: 'petunia', kind: 'flower', indoor: false, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 10, optLow: 18, optHigh: 26, max: 35, survive: 0 }, life: 'annual', days: 70, source: GUIDE },
  { id: 'begonia', name: 'bedding begonia', nameIt: 'begonia', kind: 'flower', indoor: false, outdoor: true, sun: { min: 2, ideal: 4 }, temp: { min: 12, optLow: 18, optHigh: 24, max: 30, survive: 2 }, life: 'annual', days: 80, source: `${GUIDE}; wax begonia, grown as an annual` },
  { id: 'sunflower', name: 'sunflower', nameIt: 'girasole', kind: 'flower', indoor: false, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 10, optLow: 20, optHigh: 27, max: 35, survive: 0 }, life: 'annual', days: 90, source: GUIDE },
  { id: 'cosmos', name: 'cosmos', nameIt: 'cosmea', kind: 'flower', indoor: false, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 10, optLow: 18, optHigh: 26, max: 35, survive: 0 }, life: 'annual', days: 70, source: GUIDE },
  { id: 'impatiens', name: 'busy Lizzie', nameIt: 'impatiens', kind: 'flower', indoor: false, outdoor: true, sun: { min: 1, ideal: 2, max: 5 }, temp: { min: 12, optLow: 18, optHigh: 24, max: 30, survive: 2 }, life: 'annual', days: 70, source: `${GUIDE}; Impatiens walleriana, for shade` },
  { id: 'fuchsia', name: 'fuchsia', nameIt: 'fucsia', kind: 'flower', indoor: false, outdoor: true, sun: { min: 2, ideal: 3, max: 6 }, temp: { min: 8, optLow: 15, optHigh: 22, max: 27, survive: -5 }, life: 'perennial', source: `${GUIDE}; hardiness varies by variety` },
  { id: 'ornamental-salvia', name: 'ornamental salvia', nameIt: 'salvia ornamentale', kind: 'flower', indoor: false, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 5, optLow: 15, optHigh: 25, max: 35, survive: -15 }, life: 'perennial', source: `${GUIDE}; Salvia nemorosa and similar` },
  { id: 'calendula', name: 'pot marigold', nameIt: 'calendula', kind: 'flower', indoor: false, outdoor: true, sun: { min: 4, ideal: 6 }, temp: { min: 5, optLow: 12, optHigh: 22, max: 30, survive: -5 }, life: 'annual', days: 60, source: GUIDE },
  { id: 'jasmine', name: 'star jasmine', nameIt: 'gelsomino rampicante', kind: 'flower', indoor: false, outdoor: true, sun: { min: 4, ideal: 6 }, temp: { min: 5, optLow: 18, optHigh: 28, max: 38, survive: -10 }, life: 'perennial', source: `${GUIDE}; Trachelospermum, a climber that needs a support` },
  { id: 'clematis', name: 'clematis', nameIt: 'clematide', kind: 'flower', indoor: false, outdoor: true, sun: { min: 4, ideal: 6 }, temp: { min: 5, optLow: 15, optHigh: 24, max: 30, survive: -20 }, life: 'perennial', source: `${GUIDE}; climber; likes a cool, shaded root zone` },

  { id: 'pothos', name: 'pothos', nameIt: 'pothos', kind: 'houseplant', indoor: true, outdoor: false, sun: { min: 0, ideal: 1, max: 3 }, temp: { min: 15, optLow: 18, optHigh: 27, max: 32, survive: 10 }, life: 'perennial', source: `${GUIDE}; bright indirect light assumed` },
  { id: 'snake-plant', name: 'snake plant', nameIt: 'sansevieria', kind: 'houseplant', indoor: true, outdoor: false, sun: { min: 0, ideal: 2 }, temp: { min: 10, optLow: 18, optHigh: 27, max: 35, survive: 5 }, life: 'perennial', source: `${GUIDE}; copes with low light` },
  { id: 'fern', name: 'Boston fern', nameIt: 'felce di Boston', kind: 'houseplant', indoor: true, outdoor: false, sun: { min: 0, ideal: 1, max: 2 }, temp: { min: 15, optLow: 18, optHigh: 24, max: 30, survive: 10 }, life: 'perennial', source: `${GUIDE}; bright indirect light assumed` },
  { id: 'spider-plant', name: 'spider plant', nameIt: 'clorofito', kind: 'houseplant', indoor: true, outdoor: false, sun: { min: 0, ideal: 2, max: 4 }, temp: { min: 10, optLow: 18, optHigh: 27, max: 32, survive: 5 }, life: 'perennial', source: GUIDE },
  { id: 'aloe', name: 'aloe vera', nameIt: 'aloe vera', kind: 'houseplant', indoor: true, outdoor: true, sun: { min: 4, ideal: 6 }, temp: { min: 10, optLow: 18, optHigh: 27, max: 38, survive: 4 }, life: 'perennial', source: GUIDE },
  { id: 'monstera', name: 'monstera', nameIt: 'monstera', kind: 'houseplant', indoor: true, outdoor: false, sun: { min: 0, ideal: 1, max: 3 }, temp: { min: 15, optLow: 18, optHigh: 27, max: 32, survive: 10 }, life: 'perennial', source: `${GUIDE}; bright indirect light assumed` },
  { id: 'peace-lily', name: 'peace lily', nameIt: 'spatifillo', kind: 'houseplant', indoor: true, outdoor: false, sun: { min: 0, ideal: 1, max: 2 }, temp: { min: 15, optLow: 18, optHigh: 26, max: 32, survive: 10 }, life: 'perennial', source: `${GUIDE}; bright indirect light assumed` },
  { id: 'zz-plant', name: 'ZZ plant', nameIt: 'zamioculcas', kind: 'houseplant', indoor: true, outdoor: false, sun: { min: 0, ideal: 1, max: 4 }, temp: { min: 12, optLow: 18, optHigh: 26, max: 32, survive: 8 }, life: 'perennial', source: `${GUIDE}; copes with low light` },
  { id: 'rubber-plant', name: 'rubber plant', nameIt: 'ficus elastica', kind: 'houseplant', indoor: true, outdoor: false, sun: { min: 0, ideal: 2, max: 4 }, temp: { min: 12, optLow: 18, optHigh: 27, max: 32, survive: 8 }, life: 'perennial', source: `${GUIDE}; bright indirect light assumed` },
  { id: 'calathea', name: 'calathea', nameIt: 'calathea', kind: 'houseplant', indoor: true, outdoor: false, sun: { min: 0, ideal: 1, max: 2 }, temp: { min: 16, optLow: 19, optHigh: 26, max: 30, survive: 12 }, life: 'perennial', source: `${GUIDE}; bright indirect light assumed` },
  { id: 'jade-plant', name: 'jade plant', nameIt: 'albero di giada', kind: 'houseplant', indoor: true, outdoor: true, sun: { min: 4, ideal: 6 }, temp: { min: 10, optLow: 18, optHigh: 27, max: 35, survive: 2 }, life: 'perennial', source: `${GUIDE}; succulent; bring indoors for winter` },
  { id: 'orchid', name: 'moth orchid', nameIt: 'orchidea', kind: 'houseplant', indoor: true, outdoor: false, sun: { min: 0, ideal: 1, max: 2 }, temp: { min: 15, optLow: 18, optHigh: 27, max: 32, survive: 10 }, life: 'perennial', source: `${GUIDE}; bright indirect light assumed; direct midday sun scorches` },
]

export const plantById = (id: string): Plant | undefined => PLANTS.find((p) => p.id === id)
