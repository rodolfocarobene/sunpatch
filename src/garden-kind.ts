import type { PlantResult } from './garden'
import type { Key } from './i18n'
import type { PlantKind } from './plants'

// The kind filter of the Garden spot card's plant list: pure helpers plus the remembered choice.

export type KindFilter = PlantKind | 'all'

/** The chips, in order, with their label keys (plural: "Herbs"). */
export const KIND_FILTERS: { value: KindFilter; label: Key }[] = [
  { value: 'all', label: 'garden.filterAll' },
  { value: 'vegetable', label: 'garden.filterVegetable' },
  { value: 'fruit', label: 'garden.filterFruit' },
  { value: 'herb', label: 'garden.filterHerb' },
  { value: 'flower', label: 'garden.filterFlower' },
  { value: 'houseplant', label: 'garden.filterHouseplant' },
]

const STORAGE_KEY = 'sunpatch.gardenKind'
const VALID = new Set<string>(KIND_FILTERS.map((k) => k.value))

export const isKindFilter = (value: unknown): value is KindFilter => typeof value === 'string' && VALID.has(value)

/** The plants of one kind (all of them for 'all'), order kept. */
export const filterByKind = (ranked: PlantResult[], kind: KindFilter): PlantResult[] => (kind === 'all' ? ranked : ranked.filter((r) => r.plant.kind === kind))

/** The best plant that is not poor, among the filtered ones. */
export const bestOfKind = (ranked: PlantResult[], kind: KindFilter): PlantResult | undefined => filterByKind(ranked, kind).find((r) => r.rating !== 'poor')

let current: KindFilter = 'all'
try {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (isKindFilter(saved)) current = saved
} catch {
  /* storage can be blocked */
}

export const getKindFilter = (): KindFilter => current

export function setKindFilter(kind: KindFilter): void {
  current = kind
  try {
    localStorage.setItem(STORAGE_KEY, kind)
  } catch {
    /* storage can be blocked */
  }
}
