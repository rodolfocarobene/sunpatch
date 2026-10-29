import { Group, Mesh, MeshBasicMaterial } from 'three'
import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/overpass-milan-duomo.json'
import { apartmentGeometry } from './apartment'
import { buildExample } from './example'
import { buildingGeometry } from './footprint'
import { hiddenOutlines, type Building, type OverpassElement, type Point } from './osm'
import { floorBase, type Plan } from './plan'
import { floorGrid, sampleMinutes, spotStats, sunSlots, type SunMapResult } from './sunmap'
import { buildBvh, collectOccluders, traceSun } from './sunmap-trace'
import { buildTreeGroup, scatterTrees } from './trees'

const casting = (geometries: Mesh['geometry'][], group = new Group()) => {
  for (const geometry of geometries) {
    const mesh = new Mesh(geometry, new MeshBasicMaterial())
    mesh.castShadow = true
    group.add(mesh)
  }
  return group
}

function compute(roots: Group[], plan: Plan, selected: Building, day: Date, lat: number, lon: number): SunMapResult {
  const start = performance.now()
  const bvh = buildBvh(collectOccluders(roots))
  const grid = floorGrid(plan)
  const slots = sunSlots(day, lat, lon)
  const points = new Float32Array(grid.count * 2)
  for (let s = 0; s < grid.count; s++) points.set([grid.xs[s], grid.zs[s]], s * 2)
  const lit = traceSun(bvh, points, floorBase(selected, plan), slots.dirs)
  return { grid, starts: slots.starts, lit, daylightMinutes: slots.starts.length * 5, ms: performance.now() - start }
}

describe('sun map of the Milan example', () => {
  const example = buildExample(fixture.elements as unknown as OverpassElement[])
  const { buildings, selected, plan, origin } = example
  const world = new Group()
  const hidden = hiddenOutlines(buildings)
  const own = new Set(selected.sources ?? [selected.id])
  casting(buildings.filter((b) => !hidden.has(b.id) && !own.has(b.id)).map(buildingGeometry), world)
  const g = apartmentGeometry(selected, plan)
  casting([...g.shell, ...g.ceiling, g.floor, ...g.walls, ...g.added, ...g.addedAbove], world)
  const trees = buildTreeGroup(scatterTrees(example.green, buildings))
  const { lat, lon } = origin
  const mean = (r: SunMapResult) => sampleMinutes(r).reduce((a, b) => a + b, 0) / r.grid.count

  it('computes a 120 m2 apartment for a whole day in a few seconds and lights the floor in winter and summer', () => {
    const winter = compute([world, trees], plan, selected, new Date(2026, 11, 21), lat, lon)
    const summer = compute([world, trees], plan, selected, new Date(2026, 5, 21), lat, lon)
    const triangles = collectOccluders([world, trees]).length / 9
    console.info(
      `sun map Milan example: ${winter.grid.count} samples, ${triangles} triangles; ` +
        `21 Dec ${winter.starts.length} slots ${winter.ms.toFixed(0)} ms, mean ${mean(winter).toFixed(0)} min; ` +
        `21 Jun ${summer.starts.length} slots ${summer.ms.toFixed(0)} ms, mean ${mean(summer).toFixed(0)} min`,
    )
    const pct = (r: SunMapResult) => { const m = [...sampleMinutes(r)].sort((a, b) => a - b); return [0.1, 0.5, 0.75, 0.9, 1].map((q) => m[Math.min(m.length - 1, Math.floor(q * m.length))]).join('/') }
    console.info(`percentiles(10/50/75/90/100) dec ${pct(winter)} jun ${pct(summer)}`)
    expect(winter.grid.count).toBeGreaterThan(1000)
    expect(winter.ms).toBeLessThan(15000)
    // Direct sun on the floor on both days, and the two days are not the same map
    expect(mean(winter)).toBeGreaterThan(5)
    expect(mean(summer)).toBeGreaterThan(5)
    expect(mean(summer)).not.toBeCloseTo(mean(winter), 0)
    // The spots differ in how long they get sun, and a spot's intervals add up to its minutes
    const minutes = sampleMinutes(winter)
    expect(Math.max(...minutes)).toBeGreaterThan(Math.min(...minutes) + 30)
    const best = minutes.indexOf(Math.max(...minutes))
    const stats = spotStats(winter, best)
    expect(stats.intervals.reduce((sum, i) => sum + (i.to - i.from), 0)).toBe(stats.minutes)
  })
})

describe('a north-facing window', () => {
  const outer: Point[] = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 6 }, { x: 0, z: 6 }]
  const building: Building = { id: 'way/1', outer, holes: [], minHeight: 0, height: 12, heightSource: 'tag', tags: {} }
  // Edge 0 runs along z = 0: the north wall (north is -z). Wide French window.
  const plan: Plan = {
    version: 1, buildingId: 'way/1', origin: { lat: 45.46, lon: 9.19 }, floor: 1, floorHeight: 3, outline: { outer, holes: [] },
    walls: [], windows: [{ ring: 0, edge: 0, t: 0.5, width: 4, sill: 0.3, height: 2.2 }],
  }
  const g = apartmentGeometry(building, plan)
  const world = casting([...g.shell, ...g.ceiling, g.floor, ...g.walls, ...g.added, ...g.addedAbove])

  it('gets no direct sun on 21 December and only a little near the window on 21 June', () => {
    const winter = compute([world], plan, building, new Date(2026, 11, 21), 45.46, 9.19)
    const summer = compute([world], plan, building, new Date(2026, 5, 21), 45.46, 9.19)
    expect(Math.max(...sampleMinutes(winter))).toBe(0)
    const june = sampleMinutes(summer)
    expect(Math.max(...june)).toBeGreaterThan(0)
    expect(Math.max(...june)).toBeLessThan(summer.daylightMinutes / 3)
  })
})
