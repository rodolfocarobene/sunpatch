import { BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Ray } from 'three'
import { describe, expect, it } from 'vitest'
import { apartmentGeometry, facadeWall } from './apartment'
import type { Building, Point } from './osm'
import { floorBase, type Plan, type Window } from './plan'
import { floorGrid, sunSlots } from './sunmap'
import { buildBvh, collectOccluders, seesSun, traceSun } from './sunmap-trace'

const unit = (x: number, y: number, z: number) => {
  const l = Math.hypot(x, y, z)
  return [x / l, y / l, z / l]
}

const shadowBox = (w: number, h: number, d: number, at: [number, number, number], cast = true) => {
  const mesh = new Mesh(new BoxGeometry(w, h, d), new MeshBasicMaterial())
  mesh.position.set(...at)
  mesh.castShadow = cast
  return mesh
}

const casting = (...geometries: BoxGeometry[] | Mesh['geometry'][]) => {
  const group = new Group()
  for (const geometry of geometries) {
    const mesh = new Mesh(geometry, new MeshBasicMaterial())
    mesh.castShadow = true
    group.add(mesh)
  }
  return group
}

describe('collectOccluders', () => {
  it('takes visible shadow casters only: glass and overlays (castShadow off) and hidden meshes are left out', () => {
    const root = new Group()
    const wall = shadowBox(1, 1, 1, [0, 0, 0])
    const glass = shadowBox(1, 1, 1, [5, 0, 0], false)
    const hidden = shadowBox(1, 1, 1, [9, 0, 0])
    hidden.visible = false
    root.add(wall, glass, hidden)
    expect(collectOccluders([root]).length).toBe(12 * 9) // one box: 12 triangles of nine numbers
  })

  it('applies world transforms and expands instanced meshes', () => {
    const trees = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial(), 3)
    trees.castShadow = true
    for (let i = 0; i < 3; i++) trees.setMatrixAt(i, new Matrix4().makeTranslation(i * 10, 0, 0))
    const moved = new Group()
    moved.position.set(0, 100, 0)
    moved.add(trees)
    const triangles = collectOccluders([moved])
    expect(triangles.length).toBe(3 * 12 * 9)
    let minY = Infinity
    for (let i = 1; i < triangles.length; i += 3) minY = Math.min(minY, triangles[i])
    expect(minY).toBeCloseTo(99.5)
  })
})

describe('seesSun against a box occluder', () => {
  // A 4 m wide, 6 m tall wall 3 m south of the origin, 0.5 m thick.
  const bvh = buildBvh(collectOccluders([new Group().add(shadowBox(4, 6, 0.5, [0, 3, 3]))]))
  const ray = new Ray()
  const see = (x: number, y: number, z: number, dir: number[]) => seesSun(bvh, ray, x, y, z, dir)

  it('blocks a ray that runs into the box and lets one over or beside it pass', () => {
    expect(see(0, 0.05, 0, unit(0, 1, 1))).toBe(false) // 45 deg: reaches the wall at 2.75 m up
    expect(see(0, 0.05, 0, unit(0, 4, 1))).toBe(true) // steep: 11 m up at the wall, over it
    expect(see(3, 0.05, 0, unit(0, 1, 1))).toBe(true) // beside the wall (past its 2 m half width)
    expect(see(0, 0.05, 0, unit(0, 1, -1))).toBe(true) // sun on the other side
  })
})

describe('the window opening lets the sun through', () => {
  const outer: Point[] = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 6 }, { x: 0, z: 6 }]
  const building: Building = { id: 'way/1', outer, holes: [], minHeight: 0, height: 12, heightSource: 'tag', tags: {} }
  const window: Window = { ring: 0, edge: 0, t: 0.5, width: 1.2, sill: 0.9, height: 1.4 }
  const plan: Plan = {
    version: 1, buildingId: 'way/1', origin: { lat: 45, lon: 9 }, floor: 1, floorHeight: 3, outline: { outer, holes: [] }, walls: [], windows: [window], panels: [],
  }
  // The facade wall on edge 0 (z = 0, interior toward +z), floor at y = 3: window x 4.4..5.6, y 3.9..5.3.
  const bvh = buildBvh(collectOccluders([casting(facadeWall(plan, building, 0, 0)!.wall)]))
  const ray = new Ray()
  const north45 = unit(0, 1, -1)

  it('passes a ray through the opening', () => {
    expect(seesSun(bvh, ray, 5, 3.05, 1.5, north45)).toBe(true)
  })
  it('stops the same ray beside the opening, and a low sun under the sill', () => {
    expect(seesSun(bvh, ray, 7, 3.05, 1.5, north45)).toBe(false)
    expect(seesSun(bvh, ray, 5, 3.05, 0.6, unit(0, 0.2, -1))).toBe(false)
  })
  it('does not let glass block: the pane is its own geometry with castShadow off', () => {
    const f = facadeWall(plan, building, 0, 0)!
    expect(f.glass).toHaveLength(1)
    const pane = new Mesh(f.glass[0], new MeshBasicMaterial())
    expect(collectOccluders([new Group().add(pane)]).length).toBe(0)
  })

  it('lights the floor near a south window and not deep inside, with the real apartment geometry', () => {
    // Window in the south wall (edge 2, z = 6), interior toward -z; sun in the south at 26.6 deg (tan 0.5).
    const south: Plan = { ...plan, windows: [{ ...window, edge: 2, t: 0.5, width: 3, sill: 0.3, height: 2 }] }
    const g = apartmentGeometry(building, south)
    const group = casting(...g.shell, ...g.ceiling, g.floor, ...g.walls, ...g.added, ...g.addedAbove)
    const lit = traceSun(buildBvh(collectOccluders([group])), Float32Array.from([5, 5, 5, 0.5]), floorBase(building, south), Float32Array.from(unit(0, 0.5, 1)))
    // Sample 0 is 0.7 m from the wall's inner face, sample 1 is 5.2 m away: over that distance the sun rises 0.35 m
    // and 2.6 m (plus the 5 cm start), and the opening spans 0.3 to 2.3 m, so only the near one sees through it.
    expect(Array.from(lit)).toEqual([1, 0])
  })

  it('runs a whole day through the grid, and a roof over everything keeps it dark', () => {
    const grid = floorGrid(plan)
    const slots = sunSlots(new Date(2026, 5, 21), 45.46, 9.19)
    const roof = buildBvh(collectOccluders([casting(new BoxGeometry(1e6, 0.1, 1e6).translate(0, 10, 0))]))
    const points = Float32Array.from(Array.from({ length: grid.count }, (_, i) => [grid.xs[i], grid.zs[i]]).flat())
    const lit = traceSun(roof, points, 3, slots.dirs)
    expect(lit.length).toBe(grid.count * slots.starts.length)
    expect(lit.every((v) => v === 0)).toBe(true)
  })
})
