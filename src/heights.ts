import { mergeSelection } from './block'
import type { Building } from './osm'

/**
 * The user's own height for one OSM polygon, stored with the plan (`plan.heights`, keyed by polygon id).
 * `height` is the top above the ground; `levels` is set when it was entered in floors, so the apartment
 * gets exactly that many storeys; `minHeight` replaces the data's start height when present.
 */
export interface HeightOverride {
  height: number
  minHeight?: number
  levels?: number
}

export type HeightOverrides = Record<string, HeightOverride>

/** Floor-to-floor height used to turn floors into metres (the same 3 m OSM levels get). */
export const FLOOR_M = 3
export const MAX_HEIGHT_M = 500
export const MAX_FLOORS = 150

/** The height is a guess: the 9 m default, or an estimate from the parts above the outline. */
export const isGuessed = (b: Building): boolean => b.heightSource === 'default' || b.heightSource === 'parts'

/** The polygons with the user's heights applied; a polygon without an override is returned as it is. */
export function applyHeights(buildings: Building[], overrides: HeightOverrides | undefined): Building[] {
  if (!overrides) return buildings
  return buildings.map((b) => {
    const o = overrides[b.id]
    if (!o) return b
    const { levels: _, ...rest } = b
    const minHeight = o.minHeight !== undefined && o.minHeight < o.height ? o.minHeight : b.minHeight < o.height ? b.minHeight : 0
    return {
      ...rest,
      height: o.height,
      minHeight,
      heightSource: 'user',
      ...(o.levels !== undefined ? { levels: o.levels } : {}),
      dataHeight: b.dataHeight ?? { height: b.height, heightSource: b.heightSource },
    }
  })
}

/** The selection rebuilt from the same polygons after their heights changed (the plan key stays). */
export function reselect(buildings: Building[], selected: Building): Building {
  const byId = new Map(buildings.map((b) => [b.id, b]))
  if (!selected.sources) return byId.get(selected.id) ?? selected
  const seed = byId.get(selected.anchor ?? selected.id)
  if (!seed || !selected.sources.every((id) => byId.has(id))) return selected
  const merged = mergeSelection(buildings, seed, { ids: selected.sources, id: selected.id })
  return selected.capped ? { ...merged, capped: true } : merged
}

/** The override a number typed in `unit` makes for `b`: floors count from where the building starts. */
export function overrideFor(b: Building, value: number, unit: 'floors' | 'm'): HeightOverride {
  if (unit === 'm') return { height: round(value) }
  return { height: round(b.minHeight + value * FLOOR_M), levels: value }
}

/** The value shown for `b` in `unit` (floors: its levels, else the height over 3 m). */
export function heightIn(b: Building, unit: 'floors' | 'm'): number {
  if (unit === 'm') return round(b.height)
  return b.levels ?? round(Math.max(1, (b.height - b.minHeight) / FLOOR_M), 1)
}

/** Whether `value` is an acceptable number for the unit: positive, whole floors, a sane height. */
export function validHeight(value: number, unit: 'floors' | 'm'): boolean {
  if (!Number.isFinite(value) || value <= 0) return false
  return unit === 'm' ? value <= MAX_HEIGHT_M : Number.isInteger(value) && value <= MAX_FLOORS
}

const round = (v: number, digits = 2) => Math.round(v * 10 ** digits) / 10 ** digits

/** The overrides for polygons that exist in `buildings` only, or undefined when none are left. */
export function keepKnown(overrides: HeightOverrides | undefined, buildings: Building[]): HeightOverrides | undefined {
  if (!overrides) return undefined
  const ids = new Set(buildings.map((b) => b.id))
  const kept = Object.fromEntries(Object.entries(overrides).filter(([id]) => ids.has(id)))
  return Object.keys(kept).length ? kept : undefined
}

/** Checks the `heights` of a stored or imported plan; entries that are not usable are dropped. */
export function parseHeights(value: unknown): HeightOverrides | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const out: HeightOverrides = {}
  const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= MAX_HEIGHT_M
  for (const [id, raw] of Object.entries(value)) {
    const o = raw as Partial<HeightOverride> | null
    if (!o || !positive(o.height)) continue
    const entry: HeightOverride = { height: o.height }
    if (typeof o.minHeight === 'number' && Number.isFinite(o.minHeight) && o.minHeight >= 0 && o.minHeight < o.height) entry.minHeight = o.minHeight
    if (typeof o.levels === 'number' && Number.isInteger(o.levels) && o.levels > 0 && o.levels <= MAX_FLOORS) entry.levels = o.levels
    out[id] = entry
  }
  return Object.keys(out).length ? out : undefined
}
