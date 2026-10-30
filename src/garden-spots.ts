import type { Building } from './osm'
import { floorBase, type Plan } from './plan'
import { floorGrid } from './sunmap'
import { groundSamples, roofSamples, standAzimuth } from './suitability'

// Where a plant could stand, for the gardener: sample points indoors (the apartment floor), on the ground around the
// building and on its roof. garden-trace.ts measures their sun and garden-job.ts runs it; garden.ts judges plants.

/**
 * Sample points sit this high above the surface: a pot on the floor or a windowsill (a pot of 20 to 30 cm on a sill
 * is higher, on the ground lower; one height keeps the maps comparable).
 */
export const POT_HEIGHT = 0.4
/** Indoor cells, metres: a pot needs no finer grid than this. */
export const INDOOR_CELL = 0.5
/** Most spots of each kind; a longer list is thinned evenly. About 3000 spots trace in a few seconds on 4 cores. */
export const INDOOR_CAP = 600
export const GROUND_CAP = 1500
export const ROOF_CAP = 900

export type SpotKind = 'indoor' | 'ground' | 'roof' | 'point'

export interface GardenSpot {
  x: number
  /** Height of the pot, scene metres. */
  y: number
  z: number
  indoor: boolean
  kind: SpotKind
}

/** At most `cap` items of `items`, evenly spread. */
function thin<T>(items: T[], cap: number): T[] {
  if (items.length <= cap) return items
  return Array.from({ length: cap }, (_, i) => items[Math.floor((i * items.length) / cap)])
}

/** The apartment floor on a 0.5 m grid, at pot height above the floor of the plan's storey. */
export function indoorSpots(selected: Building, plan: Plan): GardenSpot[] {
  const grid = floorGrid(plan, INDOOR_CELL)
  const y = floorBase(selected, plan) + POT_HEIGHT
  const spots = Array.from({ length: grid.count }, (_, i) => ({ x: grid.xs[i], y, z: grid.zs[i], indoor: true, kind: 'indoor' as const }))
  return thin(spots, INDOOR_CAP)
}

/** The ground ring around the building (2 m cells, 18 m out) at pot height. */
export function groundSpots(selected: Building, buildings: Building[], lat: number): GardenSpot[] {
  const cells = groundSamples(selected, buildings, standAzimuth(lat))
  return thin(cells, GROUND_CAP).map((s) => ({ x: s.x, y: s.y + POT_HEIGHT, z: s.z, indoor: false, kind: 'ground' }))
}

/** The roof or terrace of the selected building (1 m cells) at pot height. */
export function roofSpots(selected: Building, lat: number): GardenSpot[] {
  const cells = roofSamples(selected, standAzimuth(lat))
  return thin(cells, ROOF_CAP).map((s) => ({ x: s.x, y: s.y + POT_HEIGHT, z: s.z, indoor: false, kind: 'roof' }))
}

/** Every spot of a garden analysis: indoor first when there is a plan, then ground, then roof. */
export function gardenSpots(selected: Building, buildings: Building[], plan: Plan | undefined, lat: number): GardenSpot[] {
  return [...(plan ? indoorSpots(selected, plan) : []), ...groundSpots(selected, buildings, lat), ...roofSpots(selected, lat)]
}

/** One clicked point: `y` is the surface the click hit, the pot stands `POT_HEIGHT` above it. */
export const pointSpot = (x: number, y: number, z: number, indoor: boolean): GardenSpot => ({ x, y: y + POT_HEIGHT, z, indoor, kind: 'point' })

/** The spots' positions as x, y, z triples for tracing. */
export function spotPoints(spots: GardenSpot[]): Float32Array {
  const out = new Float32Array(spots.length * 3)
  spots.forEach((s, i) => out.set([s.x, s.y, s.z], i * 3))
  return out
}

/** A spot with its measured sun: what `rankPlants` and `scoreSpots` take. */
export interface SunnySpot extends GardenSpot {
  /** Mean daily direct-sun minutes per month, January first. */
  sunMinutes: number[]
}

/** The spots joined with their traced minutes (twelve numbers per spot, see traceMonthly). */
export const withSun = (spots: GardenSpot[], minutes: Float32Array): SunnySpot[] =>
  spots.map((s, i) => ({ ...s, sunMinutes: Array.from(minutes.subarray(i * 12, i * 12 + 12)) }))
