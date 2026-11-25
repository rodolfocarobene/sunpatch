import { BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Ray } from 'three'
import { describe, expect, it } from 'vitest'
import { apartmentGeometry, facadeWall } from './apartment'
import type { Building, Point } from './osm'
import { floorBase, type Plan, type Window } from './plan'
import { STEP } from './daylight'
import { dayStats, floorGrid, sunSlots } from './sunmap'
import { buildBvh, collectOccluders, countSparse, facesSun, seesSun, traceSun, traceSurfaceSun } from './sunmap-trace'

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

describe('countSparse', () => {
  const lit = (from: number, to: number) => (i: number) => i >= from && i < to
  it('matches the full count for stretches longer than the stride', () => {
    for (const [a, b] of [[10, 40], [0, 50], [7, 8 + 3], [33, 60]]) {
      const asked: number[] = []
      const test = (i: number) => (asked.push(i), lit(a, b)(i))
      expect(countSparse(60, 3, test)).toBe(Math.max(0, Math.min(60, b) - a))
      expect(new Set(asked).size).toBe(asked.length)
    }
  })
  it('asks far fewer slots in a long shaded stretch', () => {
    let asked = 0
    countSparse(150, 3, () => (asked++, false))
    expect(asked).toBeLessThanOrEqual(51)
  })
  it('handles no slots', () => {
    expect(countSparse(0, 3, () => true)).toBe(0)
  })
})

describe('the sun on a wall point', () => {
  // Milan; z is south, so a south-facing wall's normal is +z and a north-facing one's is -z.
  const MILAN = { lat: 45.4642, lon: 9.19 }
  const south = { x: 0, y: 0, z: 1 }
  const north = { x: 0, y: 0, z: -1 }
  // A single far-away triangle: nothing in the way.
  const open = buildBvh(Float32Array.from([900, 900, 900, 901, 900, 900, 900, 901, 900]))
  const noonSlot = (dirs: Float32Array) => {
    let best = 0
    for (let i = 1; i < dirs.length / 3; i++) if (dirs[i * 3 + 1] > dirs[best * 3 + 1]) best = i
    return best
  }

  it('counts the sun only in front of the surface', () => {
    expect(facesSun(south, [0, 0.5, 0.8])).toBe(true)
    expect(facesSun(north, [0, 0.5, 0.8])).toBe(false)
    expect(facesSun({ x: 1, y: 0, z: 0 }, [0, 1, 0])).toBe(false) // a sun straight up grazes a wall: not in front
    expect(facesSun({ x: 0, y: 1, z: 0 }, [0, 0.1, -0.99])).toBe(true) // a sill faces every sun above the horizon
  })

  it('lights a south wall at noon in Milan in December, with nothing in the way', () => {
    const slots = sunSlots(new Date(2026, 11, 21), MILAN.lat, MILAN.lon)
    const lit = traceSurfaceSun(open, { x: 0, y: 1, z: 0 }, south, slots.dirs)
    expect(lit[noonSlot(slots.dirs)]).toBe(1)
    // In December the sun stays in the southern half of the sky all day: the whole day reaches the wall.
    const day = dayStats(lit, slots.starts)
    expect(day.minutes).toBe(slots.starts.length * STEP)
    expect(day.share).toBe(1)
    expect(day.intervals).toHaveLength(1)
  })

  it('never lights a north wall in winter', () => {
    for (const [month, date] of [[10, 21], [11, 1], [11, 21], [0, 10], [1, 1]]) {
      const slots = sunSlots(new Date(2026, month, date), MILAN.lat, MILAN.lon)
      expect(slots.starts.length).toBeGreaterThan(0)
      expect(Array.from(traceSurfaceSun(open, { x: 0, y: 1, z: 0 }, north, slots.dirs)).every((v) => v === 0)).toBe(true)
    }
  })

  it('lights a north wall early and late in June, when the sun rises and sets north of east and west', () => {
    const slots = sunSlots(new Date(2026, 5, 21), MILAN.lat, MILAN.lon)
    const day = dayStats(traceSurfaceSun(open, { x: 0, y: 1, z: 0 }, north, slots.dirs), slots.starts)
    expect(day.minutes).toBeGreaterThan(0)
    expect(day.intervals).toHaveLength(2) // morning and evening, none at noon
  })

  it('is shaded by what stands between the wall and the sun', () => {
    // A tall slab 2 m south of the wall point, wide enough to hide the winter sun all day.
    const slab = buildBvh(collectOccluders([new Group().add(shadowBox(200, 40, 0.5, [0, 20, 2]))]))
    const slots = sunSlots(new Date(2026, 11, 21), MILAN.lat, MILAN.lon)
    expect(Array.from(traceSurfaceSun(slab, { x: 0, y: 1, z: 0 }, south, slots.dirs)).every((v) => v === 0)).toBe(true)
  })
})
