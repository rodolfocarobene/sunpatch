import { unproject, type Building, type Origin, type Point } from './osm'

export const MAP_PICK_HINT = 'Click on a building to pick it.'

/** The bottom chip of the map: it only guides the first pick; once a building is picked the panel says how to switch. */
export function mapIdleHint(picked: boolean): string {
  return picked ? '' : MAP_PICK_HINT
}

export interface SelectionCollection {
  type: 'FeatureCollection'
  features: { type: 'Feature'; properties: Record<string, never>; geometry: { type: 'Polygon'; coordinates: number[][][] } }[]
}

function lngLatRing(ring: Point[], origin: Origin): number[][] {
  const coords = ring.map((p) => {
    const { lat, lon } = unproject(p, origin)
    return [lon, lat]
  })
  const first = coords[0]
  const last = coords[coords.length - 1]
  if (first && (first[0] !== last[0] || first[1] !== last[1])) coords.push([...first])
  return coords
}

/** Outlines of the picked building for the map, one polygon per part of a merged selection; empty when nothing is picked. */
export function selectionGeoJSON(selected: Building | undefined, origin: Origin | undefined): SelectionCollection {
  const parts = selected ? (selected.members ?? [selected]) : []
  return {
    type: 'FeatureCollection',
    features: !origin ? [] : parts.map((b) => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [lngLatRing(b.outer, origin), ...b.holes.map((h) => lngLatRing(h, origin))] },
    })),
  }
}
