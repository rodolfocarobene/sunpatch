import { Group, Mesh, MeshBasicMaterial } from 'three'
import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/overpass-milan-duomo.json'
import { apartmentGeometry } from './apartment'
import { buildExample } from './example'
import { buildingGeometry } from './footprint'
import { traceMonthly } from './garden-trace'
import { gardenSpots, pointSpot, spotPoints } from './garden-spots'
import { hiddenOutlines, type Building, type OverpassElement, type Point } from './osm'
import { yearSlots } from './panel-shade'
import type { Plan } from './plan'
import { buildBvh, collectOccluders } from './sunmap-trace'

const casting = (geometries: Mesh['geometry'][], group = new Group()) => {
  for (const geometry of geometries) {
    const mesh = new Mesh(geometry, new MeshBasicMaterial())
    mesh.castShadow = true
    group.add(mesh)
  }
  return group
}

const lat = 45.46
const lon = 9.19
const outer: Point[] = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 6 }, { x: 0, z: 6 }]
const building: Building = { id: 'way/1', outer, holes: [], minHeight: 0, height: 12, heightSource: 'tag', tags: {} }
const planWith = (windows: Plan['windows']): Plan => ({
  version: 1, buildingId: 'way/1', origin: { lat, lon }, floor: 1, floorHeight: 3, outline: { outer, holes: [] },
  walls: [], windows, panels: [],
})
const worldOf = (plan: Plan) => {
  const g = apartmentGeometry(building, plan)
  return casting([...g.shell, ...g.ceiling, g.floor, ...g.walls, ...g.added, ...g.addedAbove])
}
const slots = yearSlots(lat, lon, 2026)
const monthly = (world: Group, points: Float32Array) => traceMonthly(buildBvh(collectOccluders([world])), points, slots, 15, 0, points.length / 3)
const DEC = 11
const JUN = 5

describe('monthly sun at a spot', () => {
  it('gives an open point about the length of the day', () => {
    const open = monthly(worldOf(planWith([])), spotPoints([pointSpot(5, 0, -80, false)]))
    expect(open[JUN]).toBeGreaterThan(800)
    expect(open[DEC]).toBeGreaterThan(400)
    expect(open[JUN]).toBeGreaterThan(open[DEC])
  })

  it('gives a point under a roof, behind a wall, no sun in any month', () => {
    const closed = monthly(worldOf(planWith([])), spotPoints([pointSpot(5, 3, 3, true)]))
    expect(Math.max(...closed)).toBe(0)
  })

  it('gives a point behind a south window more sun in winter than in summer', () => {
    // Edge 2 runs along z = 6, the south wall. The spot is 1 m inside it.
    const window = { ring: 0, edge: 2, t: 0.5, width: 4, sill: 0.3, height: 2.2 }
    const lit = monthly(worldOf(planWith([window])), spotPoints([pointSpot(5, 3, 5, true)]))
    expect(lit[DEC]).toBeGreaterThan(60)
    expect(lit[DEC]).toBeGreaterThan(lit[JUN] + 30)
  })
})

describe('the Milan example garden', () => {
  it('traces every spot of the example plan', { timeout: 60_000 }, () => {
    const example = buildExample(fixture.elements as unknown as OverpassElement[])
    const { buildings, selected, plan, origin } = example
    const world = new Group()
    const hidden = hiddenOutlines(buildings)
    const own = new Set(selected.sources ?? [selected.id])
    casting(buildings.filter((b) => !hidden.has(b.id) && !own.has(b.id)).map(buildingGeometry), world)
    const g = apartmentGeometry(selected, plan)
    casting([...g.shell, ...g.ceiling, g.floor, ...g.walls, ...g.added, ...g.addedAbove], world)
    const spots = gardenSpots(selected, buildings, plan, origin.lat)
    const start = performance.now()
    const bvh = buildBvh(collectOccluders([world]))
    const built = performance.now()
    const out = traceMonthly(bvh, spotPoints(spots), yearSlots(origin.lat, origin.lon, 2026), 15, 0, spots.length)
    // Timing is logged, not asserted: it depends on the machine and on how many test files run at once.
    console.info(`garden Milan example: ${spots.length} spots, BVH ${(built - start).toFixed(0)} ms, trace ${(performance.now() - built).toFixed(0)} ms`)
    expect(out.length).toBe(spots.length * 12)
    expect(Math.max(...out)).toBeGreaterThan(0)
  })
})
