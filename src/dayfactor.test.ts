import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three'
import { describe, expect, it } from 'vitest'
import { apartmentGeometry, facadeWall } from './apartment'
import {
  BANDS, bandOf, cieWeight, daylightColor, GLAZING, hemisphereDirs, internalReflected, OVERCAST_HORIZONTAL, rampPosition, roomSurfaces, summarize,
} from './dayfactor'
import { glassTriangles, traceDaylight, trianglesArea } from './dayfactor-trace'
import type { Building, Point } from './osm'
import { floorBase, type Plan, type Window } from './plan'
import { buildBvh, collectOccluders } from './sunmap-trace'

describe('CIE overcast weighting', () => {
  it('integrates to the expected horizontal illuminance, 7 pi / 9 of the zenith luminance', () => {
    // E = 2 pi int L(a) sin a cos a da with L = (1 + 2 sin a) / 3, by midpoint quadrature.
    const n = 20000
    let e = 0
    for (let i = 0; i < n; i++) {
      const a = ((i + 0.5) / n) * (Math.PI / 2)
      e += ((1 + 2 * Math.sin(a)) / 3) * Math.sin(a) * Math.cos(a) * (Math.PI / 2 / n)
    }
    expect(2 * Math.PI * e).toBeCloseTo(OVERCAST_HORIZONTAL, 6)
  })

  it('gives an unobstructed point a mean weight of 1 over the cosine-distributed rays', () => {
    const d = hemisphereDirs(512)
    let sum = 0
    for (let i = 0; i < 512; i++) sum += cieWeight(d[i * 3 + 1])
    expect(sum / 512).toBeCloseTo(1, 2)
    // Unit vectors, all in the upper hemisphere.
    for (let i = 0; i < 512; i++) expect(Math.hypot(d[i * 3], d[i * 3 + 1], d[i * 3 + 2])).toBeCloseTo(1, 5)
  })

  it('weights the zenith 3 times the horizon', () => {
    expect(cieWeight(1) / cieWeight(0)).toBeCloseTo(3)
  })
})

describe('internal reflected component', () => {
  // Hand-evaluated BRE split-flux formula (BRE Digest "Estimating daylight in buildings"; Szokolay, Introduction to
  // Architectural Science), not a copied published example: a 5 x 4 m room, 2.7 m high, 2.8 m2 of glass, no glazing
  // loss, C = 39, floor 0.3, walls 0.5, ceiling 0.7.
  //   A = 2 * 20 + 18 * 2.7 = 88.6; R = (0.3 * 20 + 0.7 * 20 + 0.5 * 48.6) / 88.6 = 0.5
  //   R_fw = (6 + 12.15) / 44.3 = 0.4097, R_cw = (14 + 12.15) / 44.3 = 0.5903
  //   IRC = 0.85 * 2.8 / (88.6 * 0.5) * (39 * 0.4097 + 5 * 0.5903) = 1.017 % with clean glass; glazing 1 is an open hole, so 1.017 / 0.85
  it('matches the worked example', () => {
    expect(internalReflected(2.8, { floor: 20, walls: 18 * 2.7 }, 39, 1)).toBeCloseTo(1.017 / 0.85, 2)
  })
  it('applies the glass and frame factors, and is 0 without glass', () => {
    expect(internalReflected(2.8, { floor: 20, walls: 48.6 })).toBeCloseTo((1.017 * GLAZING) / 0.85, 2)
    expect(internalReflected(0, { floor: 20, walls: 48.6 })).toBe(0)
  })
  it('measures the surfaces of a plan outline', () => {
    const outer: Point[] = [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 4 }, { x: 0, z: 4 }]
    const courtyard: Point[] = [{ x: 1, z: 1 }, { x: 2, z: 1 }, { x: 2, z: 2 }, { x: 1, z: 2 }]
    const plan = { floorHeight: 3, outline: { outer, holes: [courtyard] } } as Plan
    expect(roomSurfaces(plan)).toEqual({ floor: 19, walls: (18 + 4) * 3 })
  })
})

describe('bands', () => {
  it('classifies at 1, 2 and 5 percent, the edge belonging to the higher band', () => {
    expect([0, 0.99, 1, 1.99, 2, 4.99, 5, 12].map(bandOf)).toEqual(['dim', 'dim', 'fair', 'fair', 'bright', 'bright', 'veryBright', 'veryBright'])
    expect(BANDS).toEqual(['dim', 'fair', 'bright', 'veryBright'])
  })
  it('summarizes the mean and the dim share', () => {
    const s = summarize([0.5, 0.5, 3, 5])
    expect(s.mean).toBeCloseTo(2.25)
    expect(s.dimShare).toBeCloseTo(0.5)
    expect(summarize([])).toEqual({ mean: 0, dimShare: 0 })
  })
  it('puts each band edge at a quarter of the ramp, and the ramp runs dark to pale', () => {
    expect([0, 1, 2, 5, 8, 20].map(rampPosition)).toEqual([0, 0.25, 0.5, 0.75, 1, 1])
    const lum = (c: number[]) => c[0] + c[1] + c[2]
    const l = [0, 1, 2, 5, 8].map((v) => lum(daylightColor(v)))
    expect([...l].sort((a, b) => a - b)).toEqual(l)
  })
})

describe('an empty room with one window', () => {
  // A 5 m (x) by 4 m (z) room, 3 m floor-to-floor, one 2 m x 1.4 m window (sill 0.9) in the south wall (z = 4).
  const outer: Point[] = [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 4 }, { x: 0, z: 4 }]
  const building: Building = { id: 'way/1', outer, holes: [], minHeight: 0, height: 6, heightSource: 'tag', tags: {} }
  const window: Window = { ring: 0, edge: 2, t: 0.5, width: 2, sill: 0.9, height: 1.4 }
  const plan: Plan = {
    version: 1, buildingId: 'way/1', origin: { lat: 45, lon: 9 }, floor: 0, floorHeight: 3, outline: { outer, holes: [] }, walls: [], windows: [window], panels: [],
  }
  const g = apartmentGeometry(building, plan)
  const group = new Group()
  for (const geometry of [...g.shell, ...g.ceiling, g.floor, ...g.walls, ...g.added, ...g.addedAbove]) {
    const mesh = new Mesh(geometry, new MeshBasicMaterial())
    mesh.castShadow = true
    group.add(mesh)
  }
  const occluders = buildBvh(collectOccluders([group]))
  const panes = glassTriangles(facadeWall(plan, building, 0, 2)!.glass)
  const glass = buildBvh(panes)
  const at = (z: number, x = 2.5) => {
    const out = new Float32Array(1)
    traceDaylight(occluders, glass, Float32Array.from([x, z]), floorBase(building, plan), 384, 0, 1, out)
    return out[0] + internalReflected(trianglesArea(panes), roomSurfaces(plan))
  }

  it('measures the glass', () => {
    expect(trianglesArea(panes)).toBeCloseTo(2.8, 4)
  })
  it('lands in the plausible 1 to 5 percent at mid-depth and is higher near the window', () => {
    const near = at(3.5)
    const mid = at(2)
    const far = at(0.4)
    expect(mid).toBeGreaterThan(1)
    expect(mid).toBeLessThan(5)
    expect(near).toBeGreaterThan(mid)
    expect(mid).toBeGreaterThan(far)
    expect(far).toBeGreaterThan(0) // the room's reflected light alone
  })
  it('sees no sky from a point beside the window wall that faces away: only the reflected light is left', () => {
    const behind = new Float32Array(1)
    // The window is 2 m wide, centred at x = 2.5: at x = 0.2, z = 0.4 the opening is at a very low angle, SC tiny.
    traceDaylight(occluders, glass, Float32Array.from([0.2, 0.4]), 0, 384, 0, 1, behind)
    expect(behind[0]).toBeLessThan(at(3.5))
  })
  it('turns an obstruction in front of the window into the 20 percent ERC rule, so it is darker than open sky', () => {
    const blocked = new Group()
    const wall = new Mesh(new BoxGeometry(40, 40, 1).translate(2.5, 20, 6), new MeshBasicMaterial())
    wall.castShadow = true
    blocked.add(...group.children.map((c) => c.clone()), wall)
    const bvh = buildBvh(collectOccluders([blocked]))
    const out = new Float32Array(1)
    traceDaylight(bvh, glass, Float32Array.from([2.5, 2]), 0, 384, 0, 1, out)
    const open = new Float32Array(1)
    traceDaylight(occluders, glass, Float32Array.from([2.5, 2]), 0, 384, 0, 1, open)
    expect(out[0]).toBeLessThan(open[0])
    expect(out[0]).toBeGreaterThan(0) // ERC: the wall's own reflected luminance
  })
})
