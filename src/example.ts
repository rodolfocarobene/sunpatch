import { mergeSelection } from './block'
import { buildingContains, parseOverpass, ringCentroid, unproject, type Building, type Origin, type OverpassElement, type Point } from './osm'
import { parseGreen, type Green } from './trees'
import { defaultPlan, type Plan } from './plan'
import { yawOf } from './walk-geom'

/** Palazzo Reale, Milan (OSM relation 36488), in the bundled fixture. */
const EXAMPLE_BUILDING = 'relation/36488'
const EXAMPLE_NEAR: Origin = { lat: 45.46278, lon: 9.19104 }
/** 21 December, 12:30: the low winter sun reaches deep into the rooms. */
export const EXAMPLE_WHEN = { date: '2026-12-21', minutes: 12 * 60 + 30 }

export interface Example {
  buildings: Building[]
  selected: Building
  origin: Origin
  plan: Plan
  green: Green
  /** The Overpass elements it was built from, and where they are centred (for switching buildings without a request). */
  elements: OverpassElement[]
  near: Origin
}

const inside = (ring: Point[], p: Point) => buildingContains({ outer: ring, holes: [] } as unknown as Building, p)

/** The sample apartment: floor 1, 12 x 10 m on the facade that faces the afternoon sun most, three French windows, one wall. */
export function examplePlan(selected: Building, origin: Origin): Plan {
  const ring = selected.outer
  let facade: { b: Point; u: Point; n: Point; score: number } | undefined
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    const len = Math.hypot(b.x - a.x, b.z - a.z)
    if (len < 20) continue // room for the 12 m apartment plus a margin
    const u = { x: (b.x - a.x) / len, z: (b.z - a.z) / len }
    let n = { x: -u.z, z: u.x } // inward normal
    const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }
    if (!inside(ring, { x: mid.x + n.x * 0.5, z: mid.z + n.z * 0.5 })) n = { x: -n.x, z: -n.z }
    const score = len * Math.max(0, n.x * 0.707 - n.z * 0.707) // outward normal toward south-west
    if (!facade || score > facade.score) facade = { b, u, n, score }
  }
  if (!facade) throw new Error('example building has no facade long enough')
  // Measure from the far end of the facade (the sunnier part of this building, as in the README demo).
  const { n } = facade
  const a = facade.b
  const u = { x: -facade.u.x, z: -facade.u.z }
  // s metres along the facade from its start, d metres inward
  const at = (s: number, d: number): Point => ({ x: a.x + u.x * s + n.x * d, z: a.z + u.z * s + n.z * d })
  const base = defaultPlan(selected, origin, 1)
  return {
    ...base,
    outline: { outer: [at(8, 0), at(20, 0), at(20, 10), at(8, 10)], holes: [] },
    walls: [{ a: at(8, 6), b: at(14, 6), thickness: 0.1 }],
    windows: [10.4, 14, 17.6].map((s) => ({ ring: 0, edge: 0, t: (s - 8) / 12, width: 2, sill: 0.3, height: 2 })),
    viewpoint: { ...at(16.5, 7.5), yaw: yawOf(-n.x, -n.z) },
  }
}

/** Builds the example scene data from Overpass elements, the same way a map pick does. */
export function buildExample(elements: OverpassElement[]): Example {
  const first = parseOverpass(elements, EXAMPLE_NEAR).buildings.find((b) => b.id.startsWith(EXAMPLE_BUILDING))
  if (!first) throw new Error('example building missing from the fixture')
  const origin = unproject(ringCentroid(first.outer), EXAMPLE_NEAR)
  const { buildings } = parseOverpass(elements, origin)
  // The sample apartment is drawn on the palace alone: flooding would add its neighbours and move the facade.
  const selected = mergeSelection(buildings, buildings.find((b) => b.id === first.id)!, { ids: [first.id] })
  return { buildings, selected, origin, plan: examplePlan(selected, origin), green: parseGreen(elements, origin), elements, near: EXAMPLE_NEAR }
}

/** Loaded on demand so the normal app does not carry the fixture. */
export async function loadExample(): Promise<Example> {
  const { default: fixture } = await import('../fixtures/overpass-milan-duomo.json')
  return buildExample(fixture.elements as unknown as OverpassElement[])
}
