import { distanceToRing, type Building } from './osm'
import { t } from './i18n'

/**
 * How far around the building the neighbours are loaded and simulated (shadow casters, sun-map and panel rays).
 * Medium is close to what the app always used (all of the 350 m of Overpass data around the click).
 */
export const NEIGHBORHOODS = [
  { id: 'small', label: 'shell.hoodSmall', radiusM: 150 },
  { id: 'medium', label: 'shell.hoodMedium', radiusM: 300 },
  { id: 'large', label: 'shell.hoodLarge', radiusM: 500 },
] as const

export type NeighborhoodId = (typeof NEIGHBORHOODS)[number]['id']
export const DEFAULT_NEIGHBORHOOD: NeighborhoodId = 'medium'

export const neighborhoodRadius = (id: NeighborhoodId): number => NEIGHBORHOODS.find((n) => n.id === id)!.radiusM

/** A stored value back to a size; anything unknown (or missing) is the default. */
export function parseNeighborhood(value: string | null | undefined): NeighborhoodId {
  return NEIGHBORHOODS.find((n) => n.id === value)?.id ?? DEFAULT_NEIGHBORHOOD
}

/** The buildings with an edge within `radiusM` of the scene origin; those in `keep` (the selection's polygons) always stay. */
export function withinRadius(buildings: Building[], radiusM: number, keep: Iterable<string> = []): Building[] {
  const kept = new Set(keep)
  return buildings.filter((b) => kept.has(b.id) || distanceToRing(b.outer, { x: 0, z: 0 }) <= radiusM)
}

/** Whether data that holds everything within `dataRadiusM` of its centre holds the `radiusM` circle around a point `distanceM` from that centre. */
export const covers = (dataRadiusM: number, distanceM: number, radiusM: number): boolean => distanceM + radiusM <= dataRadiusM

/** Buildings as people count them: a part of a building ("building:part" alone) is not one more building. */
export const countBuildings = (buildings: Building[]): number =>
  buildings.filter((b) => !('building:part' in b.tags) || 'building' in b.tags).length

/** "214 buildings within 300 m" (the count is of what the scene holds, the selection included). */
export function neighborhoodLine(count: number, radiusM: number): string {
  return t('shell.hoodLine', { n: count, r: radiusM })
}

/** Ground, shadow-map half-width and sun distance (metres) for a scene whose neighbours reach `radiusM`. */
export function dataExtent(radiusM: number) {
  return {
    // The ground plane is `ground` wide, so it must reach past the farthest wall with room for the horizon.
    ground: Math.max(700, 2.8 * radiusM),
    // Half-width of the shadow frustum: the radius plus a margin for walls that stick out and the click not being the centre.
    shadow: Math.max(280, Math.round(radiusM * 1.12)),
    sunDistance: Math.max(500, 2 * radiusM),
  }
}
