// A small catalogue of common plants for a balcony, windowsill or small garden, with what each needs from the sun and
// the air. Figures are rounded values from general horticultural guidance (RHS, extension services, seed companies), written
// from general knowledge and not checked plant by plant; they describe a typical variety, not every cultivar.

import { getLang } from './i18n'

export type PlantKind = 'vegetable' | 'fruit' | 'herb' | 'flower' | 'houseplant'
export type SunClass = 'full sun' | 'part sun' | 'part shade' | 'shade'

export interface Plant {
  id: string
  name: string
  /** Common Italian name. */
  nameIt: string
  kind: PlantKind
  /** Exact Wikipedia article titles (English, Italian) for the plant card: the plant itself, not the food. */
  wiki: { en: string; it: string }
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
  { id: 'tomato', name: 'tomato', nameIt: 'pomodoro', kind: 'vegetable', wiki: { en: 'Tomato', it: 'Solanum lycopersicum' }, indoor: false, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 10, optLow: 20, optHigh: 27, max: 35, survive: 0 }, life: 'annual', days: 80, source: GUIDE },
  { id: 'lettuce', name: 'lettuce', nameIt: 'lattuga', kind: 'vegetable', wiki: { en: 'Lettuce', it: 'Lactuca sativa' }, indoor: true, outdoor: true, sun: { min: 3, ideal: 4 }, temp: { min: 5, optLow: 12, optHigh: 18, max: 26, survive: -5 }, life: 'annual', days: 50, source: GUIDE },
  { id: 'chard', name: 'chard', nameIt: 'bietola', kind: 'vegetable', wiki: { en: 'Chard', it: 'Beta vulgaris' }, indoor: false, outdoor: true, sun: { min: 3, ideal: 4 }, temp: { min: 5, optLow: 15, optHigh: 24, max: 32, survive: -5 }, life: 'annual', days: 60, source: GUIDE },
  { id: 'courgette', name: 'courgette', nameIt: 'zucchina', kind: 'vegetable', wiki: { en: 'Zucchini', it: 'Cucurbita pepo' }, indoor: false, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 12, optLow: 18, optHigh: 27, max: 35, survive: 0 }, life: 'annual', days: 55, source: GUIDE },
  { id: 'pepper', name: 'pepper', nameIt: 'peperone', kind: 'vegetable', wiki: { en: 'Capsicum annuum', it: 'Capsicum annuum' }, indoor: true, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 15, optLow: 21, optHigh: 29, max: 35, survive: 2 }, life: 'annual', days: 90, source: GUIDE },
  { id: 'radish', name: 'radish', nameIt: 'ravanello', kind: 'vegetable', wiki: { en: 'Radish', it: 'Raphanus sativus' }, indoor: false, outdoor: true, sun: { min: 3, ideal: 4 }, temp: { min: 5, optLow: 10, optHigh: 20, max: 28, survive: -3 }, life: 'annual', days: 30, source: GUIDE },
  { id: 'spinach', name: 'spinach', nameIt: 'spinaci', kind: 'vegetable', wiki: { en: 'Spinach', it: 'Spinacia oleracea' }, indoor: false, outdoor: true, sun: { min: 3, ideal: 4 }, temp: { min: 4, optLow: 10, optHigh: 18, max: 25, survive: -9 }, life: 'annual', days: 45, source: GUIDE },
  { id: 'bean', name: 'dwarf bean', nameIt: 'fagiolino nano', kind: 'vegetable', wiki: { en: 'Phaseolus vulgaris', it: 'Phaseolus vulgaris' }, indoor: false, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 12, optLow: 18, optHigh: 27, max: 32, survive: 0 }, life: 'annual', days: 60, source: GUIDE },
  { id: 'pea', name: 'pea', nameIt: 'pisello', kind: 'vegetable', wiki: { en: 'Pea', it: 'Pisum sativum' }, indoor: false, outdoor: true, sun: { min: 4, ideal: 6 }, temp: { min: 5, optLow: 13, optHigh: 18, max: 27, survive: -5 }, life: 'annual', days: 80, source: GUIDE },
  { id: 'carrot', name: 'carrot', nameIt: 'carota', kind: 'vegetable', wiki: { en: 'Carrot', it: 'Daucus carota' }, indoor: false, outdoor: true, sun: { min: 4, ideal: 6 }, temp: { min: 7, optLow: 15, optHigh: 21, max: 30, survive: -5 }, life: 'annual', days: 80, source: GUIDE },
  { id: 'kale', name: 'kale', nameIt: 'cavolo nero', kind: 'vegetable', wiki: { en: 'Kale', it: 'Brassica oleracea' }, indoor: false, outdoor: true, sun: { min: 3, ideal: 4 }, temp: { min: 5, optLow: 10, optHigh: 21, max: 30, survive: -10 }, life: 'annual', days: 60, source: GUIDE },
  { id: 'rocket', name: 'rocket', nameIt: 'rucola', kind: 'vegetable', wiki: { en: 'Eruca vesicaria', it: 'Eruca sativa' }, indoor: true, outdoor: true, sun: { min: 3, ideal: 4 }, temp: { min: 5, optLow: 10, optHigh: 20, max: 28, survive: -3 }, life: 'annual', days: 35, source: GUIDE },
  { id: 'strawberry', name: 'strawberry', nameIt: 'fragola', kind: 'fruit', wiki: { en: 'Strawberry', it: 'Fragaria' }, indoor: false, outdoor: true, sun: { min: 5, ideal: 6 }, temp: { min: 5, optLow: 15, optHigh: 25, max: 32, survive: -10 }, life: 'perennial', source: GUIDE },
  { id: 'aubergine', name: 'aubergine', nameIt: 'melanzana', kind: 'vegetable', wiki: { en: 'Eggplant', it: 'Solanum melongena' }, indoor: false, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 15, optLow: 21, optHigh: 29, max: 35, survive: 2 }, life: 'annual', days: 110, source: GUIDE },
  { id: 'cucumber', name: 'cucumber', nameIt: 'cetriolo', kind: 'vegetable', wiki: { en: 'Cucumber', it: 'Cucumis sativus' }, indoor: false, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 15, optLow: 20, optHigh: 28, max: 35, survive: 2 }, life: 'annual', days: 60, source: GUIDE },
  { id: 'broad-bean', name: 'broad bean', nameIt: 'fava', kind: 'vegetable', wiki: { en: 'Vicia faba', it: 'Vicia faba' }, indoor: false, outdoor: true, sun: { min: 4, ideal: 6 }, temp: { min: 3, optLow: 10, optHigh: 18, max: 27, survive: -8 }, life: 'annual', days: 120, source: `${GUIDE}; sown in autumn or late winter` },
  { id: 'onion', name: 'onion', nameIt: 'cipolla', kind: 'vegetable', wiki: { en: 'Onion', it: 'Allium cepa' }, indoor: false, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 7, optLow: 13, optHigh: 24, max: 32, survive: -7 }, life: 'annual', days: 120, source: `${GUIDE}; grown from sets` },
  { id: 'garlic', name: 'garlic', nameIt: 'aglio', kind: 'vegetable', wiki: { en: 'Garlic', it: 'Allium sativum' }, indoor: false, outdoor: true, sun: { min: 5, ideal: 6 }, temp: { min: 4, optLow: 12, optHigh: 22, max: 30, survive: -15 }, life: 'annual', days: 200, source: `${GUIDE}; planted in autumn` },
  { id: 'leek', name: 'leek', nameIt: 'porro', kind: 'vegetable', wiki: { en: 'Leek', it: 'Allium ampeloprasum' }, indoor: false, outdoor: true, sun: { min: 4, ideal: 6 }, temp: { min: 5, optLow: 13, optHigh: 22, max: 30, survive: -15 }, life: 'annual', days: 130, source: GUIDE },
  { id: 'beetroot', name: 'beetroot', nameIt: 'barbabietola', kind: 'vegetable', wiki: { en: 'Beetroot', it: 'Beta vulgaris' }, indoor: false, outdoor: true, sun: { min: 4, ideal: 6 }, temp: { min: 5, optLow: 12, optHigh: 22, max: 30, survive: -5 }, life: 'annual', days: 60, source: GUIDE },
  { id: 'broccoli', name: 'broccoli', nameIt: 'broccolo', kind: 'vegetable', wiki: { en: 'Broccoli', it: 'Brassica oleracea' }, indoor: false, outdoor: true, sun: { min: 4, ideal: 6 }, temp: { min: 5, optLow: 13, optHigh: 20, max: 28, survive: -7 }, life: 'annual', days: 80, source: GUIDE },
  { id: 'fennel', name: 'Florence fennel', nameIt: 'finocchio', kind: 'vegetable', wiki: { en: 'Fennel', it: 'Foeniculum vulgare' }, indoor: false, outdoor: true, sun: { min: 4, ideal: 6 }, temp: { min: 7, optLow: 15, optHigh: 20, max: 28, survive: -3 }, life: 'annual', days: 90, source: GUIDE },
  { id: 'potato', name: 'potato', nameIt: 'patata', kind: 'vegetable', wiki: { en: 'Potato', it: 'Solanum tuberosum' }, indoor: false, outdoor: true, sun: { min: 5, ideal: 6 }, temp: { min: 7, optLow: 15, optHigh: 20, max: 28, survive: 0 }, life: 'annual', days: 100, source: `${GUIDE}; frost kills the tops` },
  { id: 'pumpkin', name: 'pumpkin', nameIt: 'zucca', kind: 'vegetable', wiki: { en: 'Pumpkin', it: 'Cucurbita' }, indoor: false, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 12, optLow: 20, optHigh: 28, max: 35, survive: 0 }, life: 'annual', days: 110, source: `${GUIDE}; needs a large pot or ground` },
  { id: 'lambs-lettuce', name: "lamb's lettuce", nameIt: 'valerianella', kind: 'vegetable', wiki: { en: 'Valerianella locusta', it: 'Valerianella locusta' }, indoor: false, outdoor: true, sun: { min: 3, ideal: 4 }, temp: { min: 3, optLow: 8, optHigh: 18, max: 25, survive: -15 }, life: 'annual', days: 60, source: GUIDE },
  { id: 'radicchio', name: 'radicchio', nameIt: 'radicchio', kind: 'vegetable', wiki: { en: 'Radicchio', it: 'Cichorium intybus' }, indoor: false, outdoor: true, sun: { min: 4, ideal: 6 }, temp: { min: 4, optLow: 12, optHigh: 20, max: 28, survive: -8 }, life: 'annual', days: 80, source: GUIDE },
  { id: 'runner-bean', name: 'runner bean', nameIt: 'fagiolo rampicante', kind: 'vegetable', wiki: { en: 'Phaseolus coccineus', it: 'Phaseolus coccineus' }, indoor: false, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 12, optLow: 18, optHigh: 26, max: 32, survive: 0 }, life: 'annual', days: 70, source: `${GUIDE}; climbs, needs a support` },
  { id: 'melon', name: 'melon', nameIt: 'melone', kind: 'fruit', wiki: { en: 'Melon', it: 'Cucumis melo' }, indoor: false, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 15, optLow: 22, optHigh: 30, max: 38, survive: 2 }, life: 'annual', days: 90, source: GUIDE },
  { id: 'blueberry', name: 'blueberry', nameIt: 'mirtillo', kind: 'fruit', wiki: { en: 'Blueberry', it: 'Vaccinium corymbosum' }, indoor: false, outdoor: true, sun: { min: 5, ideal: 6 }, temp: { min: 5, optLow: 15, optHigh: 24, max: 32, survive: -20 }, life: 'perennial', source: `${GUIDE}; needs acid soil (ericaceous compost)` },
  { id: 'raspberry', name: 'raspberry', nameIt: 'lampone', kind: 'fruit', wiki: { en: 'Raspberry', it: 'Rubus idaeus' }, indoor: false, outdoor: true, sun: { min: 5, ideal: 6 }, temp: { min: 5, optLow: 15, optHigh: 24, max: 30, survive: -20 }, life: 'perennial', source: GUIDE },
  { id: 'lemon', name: 'lemon', nameIt: 'limone', kind: 'fruit', wiki: { en: 'Lemon', it: 'Citrus limon' }, indoor: false, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 10, optLow: 18, optHigh: 28, max: 38, survive: -2 }, life: 'perennial', source: `${GUIDE}; in a pot; protect from frost and move indoors in winter` },
  { id: 'fig', name: 'fig', nameIt: 'fico', kind: 'fruit', wiki: { en: 'Common fig', it: 'Ficus carica' }, indoor: false, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 8, optLow: 18, optHigh: 30, max: 38, survive: -12 }, life: 'perennial', source: `${GUIDE}; in a pot or the ground; young plants need frost protection` },

  { id: 'basil', name: 'basil', nameIt: 'basilico', kind: 'herb', wiki: { en: 'Basil', it: 'Ocimum basilicum' }, indoor: true, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 12, optLow: 20, optHigh: 28, max: 35, survive: 2 }, life: 'annual', days: 50, source: GUIDE },
  { id: 'parsley', name: 'parsley', nameIt: 'prezzemolo', kind: 'herb', wiki: { en: 'Parsley', it: 'Petroselinum crispum' }, indoor: true, outdoor: true, sun: { min: 3, ideal: 4 }, temp: { min: 5, optLow: 15, optHigh: 22, max: 30, survive: -10 }, life: 'perennial', source: `${GUIDE}; biennial, usually renewed yearly` },
  { id: 'rosemary', name: 'rosemary', nameIt: 'rosmarino', kind: 'herb', wiki: { en: 'Rosemary', it: 'Rosmarinus officinalis' }, indoor: true, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 10, optLow: 18, optHigh: 28, max: 38, survive: -7 }, life: 'perennial', source: GUIDE },
  { id: 'mint', name: 'mint', nameIt: 'menta', kind: 'herb', wiki: { en: 'Mentha', it: 'Mentha' }, indoor: true, outdoor: true, sun: { min: 2, ideal: 4 }, temp: { min: 8, optLow: 15, optHigh: 25, max: 32, survive: -15 }, life: 'perennial', source: GUIDE },
  { id: 'thyme', name: 'thyme', nameIt: 'timo', kind: 'herb', wiki: { en: 'Thyme', it: 'Thymus vulgaris' }, indoor: true, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 8, optLow: 18, optHigh: 27, max: 35, survive: -12 }, life: 'perennial', source: GUIDE },
  { id: 'chives', name: 'chives', nameIt: 'erba cipollina', kind: 'herb', wiki: { en: 'Chives', it: 'Allium schoenoprasum' }, indoor: true, outdoor: true, sun: { min: 4, ideal: 6 }, temp: { min: 5, optLow: 15, optHigh: 24, max: 32, survive: -20 }, life: 'perennial', source: GUIDE },
  { id: 'sage', name: 'sage', nameIt: 'salvia', kind: 'herb', wiki: { en: 'Salvia officinalis', it: 'Salvia officinalis' }, indoor: false, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 8, optLow: 18, optHigh: 27, max: 35, survive: -10 }, life: 'perennial', source: GUIDE },
  { id: 'oregano', name: 'oregano', nameIt: 'origano', kind: 'herb', wiki: { en: 'Oregano', it: 'Origanum vulgare' }, indoor: false, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 8, optLow: 18, optHigh: 27, max: 35, survive: -12 }, life: 'perennial', source: GUIDE },
  { id: 'coriander', name: 'coriander', nameIt: 'coriandolo', kind: 'herb', wiki: { en: 'Coriander', it: 'Coriandrum sativum' }, indoor: true, outdoor: true, sun: { min: 3, ideal: 4 }, temp: { min: 7, optLow: 15, optHigh: 22, max: 28, survive: -3 }, life: 'annual', days: 45, source: GUIDE },
  { id: 'bay', name: 'bay laurel', nameIt: 'alloro', kind: 'herb', wiki: { en: 'Laurus nobilis', it: 'Laurus nobilis' }, indoor: false, outdoor: true, sun: { min: 4, ideal: 6 }, temp: { min: 8, optLow: 15, optHigh: 25, max: 35, survive: -10 }, life: 'perennial', source: `${GUIDE}; slow growing; young plants need frost protection` },
  { id: 'dill', name: 'dill', nameIt: 'aneto', kind: 'herb', wiki: { en: 'Dill', it: 'Anethum graveolens' }, indoor: false, outdoor: true, sun: { min: 5, ideal: 6 }, temp: { min: 7, optLow: 15, optHigh: 22, max: 30, survive: -3 }, life: 'annual', days: 60, source: GUIDE },
  { id: 'lemon-balm', name: 'lemon balm', nameIt: 'melissa', kind: 'herb', wiki: { en: 'Melissa officinalis', it: 'Melissa officinalis' }, indoor: true, outdoor: true, sun: { min: 3, ideal: 4 }, temp: { min: 8, optLow: 15, optHigh: 25, max: 32, survive: -20 }, life: 'perennial', source: GUIDE },
  { id: 'marjoram', name: 'marjoram', nameIt: 'maggiorana', kind: 'herb', wiki: { en: 'Marjoram', it: 'Origanum majorana' }, indoor: false, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 10, optLow: 18, optHigh: 25, max: 32, survive: -5 }, life: 'perennial', source: `${GUIDE}; sweet marjoram, tender in cold winters` },
  { id: 'lemongrass', name: 'lemongrass', nameIt: 'citronella', kind: 'herb', wiki: { en: 'Cymbopogon', it: 'Cymbopogon' }, indoor: true, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 15, optLow: 22, optHigh: 32, max: 38, survive: 2 }, life: 'perennial', source: `${GUIDE}; tender; bring indoors for winter` },

  { id: 'marigold', name: 'French marigold', nameIt: 'tagete', kind: 'flower', wiki: { en: 'Tagetes patula', it: 'Tagetes patula' }, indoor: false, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 10, optLow: 18, optHigh: 27, max: 35, survive: 0 }, life: 'annual', days: 60, source: GUIDE },
  { id: 'geranium', name: 'geranium (pelargonium)', nameIt: 'geranio', kind: 'flower', wiki: { en: 'Pelargonium', it: 'Pelargonium' }, indoor: true, outdoor: true, sun: { min: 5, ideal: 6 }, temp: { min: 10, optLow: 18, optHigh: 25, max: 35, survive: 2 }, life: 'perennial', source: GUIDE },
  { id: 'nasturtium', name: 'nasturtium', nameIt: 'nasturzio', kind: 'flower', wiki: { en: 'Tropaeolum majus', it: 'Tropaeolum majus' }, indoor: false, outdoor: true, sun: { min: 4, ideal: 6 }, temp: { min: 10, optLow: 15, optHigh: 24, max: 32, survive: 0 }, life: 'annual', days: 55, source: GUIDE },
  { id: 'lavender', name: 'lavender', nameIt: 'lavanda', kind: 'flower', wiki: { en: 'Lavandula', it: 'Lavandula' }, indoor: false, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 5, optLow: 15, optHigh: 28, max: 38, survive: -12 }, life: 'perennial', source: GUIDE },
  { id: 'pansy', name: 'pansy', nameIt: 'viola del pensiero', kind: 'flower', wiki: { en: 'Pansy', it: 'Viola × wittrockiana' }, indoor: false, outdoor: true, sun: { min: 3, ideal: 4 }, temp: { min: 3, optLow: 10, optHigh: 18, max: 26, survive: -10 }, life: 'perennial', source: GUIDE },
  { id: 'petunia', name: 'petunia', nameIt: 'petunia', kind: 'flower', wiki: { en: 'Petunia', it: 'Petunia' }, indoor: false, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 10, optLow: 18, optHigh: 26, max: 35, survive: 0 }, life: 'annual', days: 70, source: GUIDE },
  { id: 'begonia', name: 'bedding begonia', nameIt: 'begonia', kind: 'flower', wiki: { en: 'Begonia', it: 'Begonia' }, indoor: false, outdoor: true, sun: { min: 2, ideal: 4 }, temp: { min: 12, optLow: 18, optHigh: 24, max: 30, survive: 2 }, life: 'annual', days: 80, source: `${GUIDE}; wax begonia, grown as an annual` },
  { id: 'sunflower', name: 'sunflower', nameIt: 'girasole', kind: 'flower', wiki: { en: 'Common sunflower', it: 'Helianthus annuus' }, indoor: false, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 10, optLow: 20, optHigh: 27, max: 35, survive: 0 }, life: 'annual', days: 90, source: GUIDE },
  { id: 'cosmos', name: 'cosmos', nameIt: 'cosmea', kind: 'flower', wiki: { en: 'Cosmos bipinnatus', it: 'Cosmos bipinnatus' }, indoor: false, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 10, optLow: 18, optHigh: 26, max: 35, survive: 0 }, life: 'annual', days: 70, source: GUIDE },
  { id: 'impatiens', name: 'busy Lizzie', nameIt: 'impatiens', kind: 'flower', wiki: { en: 'Impatiens walleriana', it: 'Impatiens walleriana' }, indoor: false, outdoor: true, sun: { min: 1, ideal: 2, max: 5 }, temp: { min: 12, optLow: 18, optHigh: 24, max: 30, survive: 2 }, life: 'annual', days: 70, source: `${GUIDE}; Impatiens walleriana, for shade` },
  { id: 'fuchsia', name: 'fuchsia', nameIt: 'fucsia', kind: 'flower', wiki: { en: 'Fuchsia', it: 'Fuchsia' }, indoor: false, outdoor: true, sun: { min: 2, ideal: 3, max: 6 }, temp: { min: 8, optLow: 15, optHigh: 22, max: 27, survive: -5 }, life: 'perennial', source: `${GUIDE}; hardiness varies by variety` },
  { id: 'ornamental-salvia', name: 'ornamental salvia', nameIt: 'salvia ornamentale', kind: 'flower', wiki: { en: 'Salvia splendens', it: 'Salvia splendens' }, indoor: false, outdoor: true, sun: { min: 6, ideal: 6 }, temp: { min: 5, optLow: 15, optHigh: 25, max: 35, survive: -15 }, life: 'perennial', source: `${GUIDE}; Salvia nemorosa and similar` },
  { id: 'calendula', name: 'pot marigold', nameIt: 'calendula', kind: 'flower', wiki: { en: 'Calendula officinalis', it: 'Calendula officinalis' }, indoor: false, outdoor: true, sun: { min: 4, ideal: 6 }, temp: { min: 5, optLow: 12, optHigh: 22, max: 30, survive: -5 }, life: 'annual', days: 60, source: GUIDE },
  { id: 'jasmine', name: 'star jasmine', nameIt: 'gelsomino rampicante', kind: 'flower', wiki: { en: 'Trachelospermum jasminoides', it: 'Trachelospermum jasminoides' }, indoor: false, outdoor: true, sun: { min: 4, ideal: 6 }, temp: { min: 5, optLow: 18, optHigh: 28, max: 38, survive: -10 }, life: 'perennial', source: `${GUIDE}; Trachelospermum, a climber that needs a support` },
  { id: 'clematis', name: 'clematis', nameIt: 'clematide', kind: 'flower', wiki: { en: 'Clematis', it: 'Clematis' }, indoor: false, outdoor: true, sun: { min: 4, ideal: 6 }, temp: { min: 5, optLow: 15, optHigh: 24, max: 30, survive: -20 }, life: 'perennial', source: `${GUIDE}; climber; likes a cool, shaded root zone` },

  { id: 'pothos', name: 'pothos', nameIt: 'pothos', kind: 'houseplant', wiki: { en: 'Epipremnum aureum', it: 'Epipremnum aureum' }, indoor: true, outdoor: false, sun: { min: 0, ideal: 1, max: 3 }, temp: { min: 15, optLow: 18, optHigh: 27, max: 32, survive: 10 }, life: 'perennial', source: `${GUIDE}; bright indirect light assumed` },
  { id: 'snake-plant', name: 'snake plant', nameIt: 'sansevieria', kind: 'houseplant', wiki: { en: 'Dracaena trifasciata', it: 'Sansevieria trifasciata' }, indoor: true, outdoor: false, sun: { min: 0, ideal: 2 }, temp: { min: 10, optLow: 18, optHigh: 27, max: 35, survive: 5 }, life: 'perennial', source: `${GUIDE}; copes with low light` },
  { id: 'fern', name: 'Boston fern', nameIt: 'felce di Boston', kind: 'houseplant', wiki: { en: 'Nephrolepis exaltata', it: 'Nephrolepis' }, indoor: true, outdoor: false, sun: { min: 0, ideal: 1, max: 2 }, temp: { min: 15, optLow: 18, optHigh: 24, max: 30, survive: 10 }, life: 'perennial', source: `${GUIDE}; bright indirect light assumed` },
  { id: 'spider-plant', name: 'spider plant', nameIt: 'clorofito', kind: 'houseplant', wiki: { en: 'Chlorophytum comosum', it: 'Chlorophytum comosum' }, indoor: true, outdoor: false, sun: { min: 0, ideal: 2, max: 4 }, temp: { min: 10, optLow: 18, optHigh: 27, max: 32, survive: 5 }, life: 'perennial', source: GUIDE },
  { id: 'aloe', name: 'aloe vera', nameIt: 'aloe vera', kind: 'houseplant', wiki: { en: 'Aloe vera', it: 'Aloe vera' }, indoor: true, outdoor: true, sun: { min: 4, ideal: 6 }, temp: { min: 10, optLow: 18, optHigh: 27, max: 38, survive: 4 }, life: 'perennial', source: GUIDE },
  { id: 'monstera', name: 'monstera', nameIt: 'monstera', kind: 'houseplant', wiki: { en: 'Monstera deliciosa', it: 'Monstera deliciosa' }, indoor: true, outdoor: false, sun: { min: 0, ideal: 1, max: 3 }, temp: { min: 15, optLow: 18, optHigh: 27, max: 32, survive: 10 }, life: 'perennial', source: `${GUIDE}; bright indirect light assumed` },
  { id: 'peace-lily', name: 'peace lily', nameIt: 'spatifillo', kind: 'houseplant', wiki: { en: 'Spathiphyllum', it: 'Spathiphyllum' }, indoor: true, outdoor: false, sun: { min: 0, ideal: 1, max: 2 }, temp: { min: 15, optLow: 18, optHigh: 26, max: 32, survive: 10 }, life: 'perennial', source: `${GUIDE}; bright indirect light assumed` },
  { id: 'zz-plant', name: 'ZZ plant', nameIt: 'zamioculcas', kind: 'houseplant', wiki: { en: 'Zamioculcas zamiifolia', it: 'Zamioculcas zamiifolia' }, indoor: true, outdoor: false, sun: { min: 0, ideal: 1, max: 4 }, temp: { min: 12, optLow: 18, optHigh: 26, max: 32, survive: 8 }, life: 'perennial', source: `${GUIDE}; copes with low light` },
  { id: 'rubber-plant', name: 'rubber plant', nameIt: 'ficus elastica', kind: 'houseplant', wiki: { en: 'Ficus elastica', it: 'Ficus elastica' }, indoor: true, outdoor: false, sun: { min: 0, ideal: 2, max: 4 }, temp: { min: 12, optLow: 18, optHigh: 27, max: 32, survive: 8 }, life: 'perennial', source: `${GUIDE}; bright indirect light assumed` },
  { id: 'calathea', name: 'calathea', nameIt: 'calathea', kind: 'houseplant', wiki: { en: 'Calathea', it: 'Calathea' }, indoor: true, outdoor: false, sun: { min: 0, ideal: 1, max: 2 }, temp: { min: 16, optLow: 19, optHigh: 26, max: 30, survive: 12 }, life: 'perennial', source: `${GUIDE}; bright indirect light assumed` },
  { id: 'jade-plant', name: 'jade plant', nameIt: 'albero di giada', kind: 'houseplant', wiki: { en: 'Crassula ovata', it: 'Crassula ovata' }, indoor: true, outdoor: true, sun: { min: 4, ideal: 6 }, temp: { min: 10, optLow: 18, optHigh: 27, max: 35, survive: 2 }, life: 'perennial', source: `${GUIDE}; succulent; bring indoors for winter` },
  { id: 'orchid', name: 'moth orchid', nameIt: 'orchidea', kind: 'houseplant', wiki: { en: 'Phalaenopsis', it: 'Phalaenopsis' }, indoor: true, outdoor: false, sun: { min: 0, ideal: 1, max: 2 }, temp: { min: 15, optLow: 18, optHigh: 27, max: 32, survive: 10 }, life: 'perennial', source: `${GUIDE}; bright indirect light assumed; direct midday sun scorches` },
]

export const plantById = (id: string): Plant | undefined => PLANTS.find((p) => p.id === id)

/** The plant's name in the current language ("tomato" / "pomodoro"), lower case as catalogued. */
export const plantName = (p: Pick<Plant, 'name' | 'nameIt'>): string => (getLang() === 'it' ? p.nameIt : p.name)

const plain = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Whether a search text matches the plant's English or Italian name, ignoring case and accents ("pomodoro" and "tomato" both find the tomato). */
export function plantMatches(p: Pick<Plant, 'name' | 'nameIt'>, query: string): boolean {
  const q = plain(query).trim()
  return q === '' || plain(p.name).includes(q) || plain(p.nameIt).includes(q)
}
