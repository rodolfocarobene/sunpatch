import { describe, expect, it } from 'vitest'
import type { Point } from './osm'
import type { Plan, Window } from './plan'
import { dropOrphanWallPots, followWindows, mountSpot, outerSillAt, wallFaceAt, wallPotAt, windowBoxAt, windowOnRay, windowOpening } from './wall-mount'

const rect = (x0: number, z0: number, x1: number, z1: number): Point[] => [
  { x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 },
]
const win = (over: Partial<Window> = {}): Window => ({ ring: 0, edge: 0, t: 0.5, width: 1.2, sill: 0.9, height: 1.4, ...over })
// rect(): edge 0 runs east along z = 0, the north facade; the room is to the south (+z). An interior wall stands at x = 4.
const plan = (outer = rect(0, 0, 10, 6), windows = [win()]): Plan => ({
  version: 1, buildingId: 'way/1', origin: { lat: 45, lon: 9 }, floor: 1, floorHeight: 3, outline: { outer, holes: [] },
  walls: [{ a: { x: 4, z: 0 }, b: { x: 4, z: 6 }, thickness: 0.1 }], windows, panels: [],
})
const BASE = 3

describe('windowOpening', () => {
  it('finds the centre on the outer face and the way out, whichever way the ring runs', () => {
    const o = windowOpening(plan(), 0)!
    expect(o.centre.x).toBeCloseTo(5)
    expect(o.centre.z).toBeCloseTo(0)
    expect(o.out.z).toBeCloseTo(-1)
    const cw = windowOpening(plan(rect(0, 0, 10, 6), [win({ t: 0.75 })]), 0)!
    const ccw = windowOpening(plan([...rect(0, 0, 10, 6)].reverse(), [win({ edge: 2, t: 0.25 })]), 0)!
    expect(ccw.centre.x).toBeCloseTo(7.5)
    expect(ccw.centre.x).toBeCloseTo(cw.centre.x)
    expect(ccw.out.z).toBeCloseTo(-1)
    expect(windowOpening(plan(), 3)).toBeUndefined()
  })
})

describe('windowBoxAt', () => {
  it('hangs the box outside the window, centred, its top just under the sill, as wide as the window', () => {
    const box = windowBoxAt(plan(), BASE, 0, 'geranium')!
    expect(box).toMatchObject({ kind: 'windowbox', plant: 'geranium', rot: 180, y: 3.6, w: 1.2 })
    expect(box.x).toBeCloseTo(5)
    expect(box.z).toBeCloseTo(-0.14)
  })

  it('caps the width', () => {
    expect(windowBoxAt(plan(rect(0, 0, 10, 6), [win({ width: 2.6 })]), BASE, 0, 'basil')!.w).toBe(1.6)
    expect(windowBoxAt(plan(rect(0, 0, 10, 6), [win({ width: 0.3 })]), BASE, 0, 'basil')!.w).toBe(0.4)
  })

  it('traces the Garden spot in front of the window, at the top of the trough', () => {
    const s = mountSpot(windowBoxAt(plan(), BASE, 0, 'basil')!)
    expect(s.x).toBeCloseTo(5)
    expect(s.z).toBeCloseTo(-0.35)
    expect(s.y).toBeCloseTo(3.8)
  })
})

describe('wallFaceAt and wallPotAt', () => {
  it('finds the inner face of a facade and either face of an interior wall, facing the room', () => {
    const facade = wallFaceAt(plan(), { x: 6, z: 0.3 }, { x: 6, z: 1 }, 0.05)!
    expect(facade.face.z).toBeCloseTo(0.3)
    expect(facade.n.z).toBeCloseTo(1)
    const east = wallFaceAt(plan(), { x: 4.05, z: 2 }, { x: 5, z: 2 }, 0.05)!
    expect(east.face.x).toBeCloseTo(4.05)
    expect(east.n.x).toBeCloseTo(1)
    const west = wallFaceAt(plan(), { x: 3.95, z: 2 }, { x: 3, z: 2 }, 0.05)!
    expect(west.face.x).toBeCloseTo(3.95)
    expect(west.n.x).toBeCloseTo(-1)
  })

  it('finds nothing in the middle of a room or on the outside of a facade', () => {
    expect(wallFaceAt(plan(), { x: 6, z: 3 }, { x: 6, z: 3.5 }, 0.05)).toBeUndefined()
    expect(wallFaceAt(plan(), { x: 6, z: 0 }, { x: 6, z: -1 }, 0.05)).toBeUndefined()
  })

  it('hangs the planter on the face at the height asked, within the storey', () => {
    const face = { face: { x: 6, z: 0.3 }, n: { x: 0, z: 1 } }
    const pot = wallPotAt(face, BASE, 3, 'pothos')
    expect(pot).toMatchObject({ kind: 'wallpot', plant: 'pothos', rot: 0, y: 4.5 })
    expect(pot.x).toBeCloseTo(6)
    expect(pot.z).toBeCloseTo(0.465)
    expect(wallPotAt(face, BASE, 3, 'pothos', 1.23).y).toBe(4.2)
    expect(wallPotAt(face, BASE, 3, 'pothos', 9).y).toBe(4.7)
    expect(wallPotAt(face, BASE, 3, 'pothos', 0).y).toBe(3.3)
  })
})

describe('windowOnRay', () => {
  it('meets the window from outside and from inside', () => {
    expect(windowOnRay(plan(), BASE, { x: 5, y: 4.5, z: -5 }, { x: 0, y: 0, z: 1 }, Infinity)).toEqual({ index: 0, outside: true })
    expect(windowOnRay(plan(), BASE, { x: 5, y: 4.5, z: 3 }, { x: 0, y: 0, z: -1 }, Infinity)).toEqual({ index: 0, outside: false })
  })

  it('misses beside it, behind what the ray hit first, and under the sill from inside', () => {
    expect(windowOnRay(plan(), BASE, { x: 8, y: 4.5, z: -5 }, { x: 0, y: 0, z: 1 }, Infinity)).toBeUndefined()
    expect(windowOnRay(plan(), BASE, { x: 5, y: 4.5, z: -5 }, { x: 0, y: 0, z: 1 }, 3)).toBeUndefined()
    expect(windowOnRay(plan(), BASE, { x: 5, y: 3.6, z: -5 }, { x: 0, y: 0, z: 1 }, Infinity)).toEqual({ index: 0, outside: true })
    expect(windowOnRay(plan(), BASE, { x: 5, y: 3.6, z: 3 }, { x: 0, y: 0, z: -1 }, Infinity)).toBeUndefined()
  })
})

describe('outerSillAt', () => {
  it('names the window whose outer sill holds the point, not the inner one', () => {
    expect(outerSillAt(plan(), BASE, { x: 5, y: 3.9, z: 0.1 })).toBe(0)
    expect(outerSillAt(plan(), BASE, { x: 5, y: 3.9, z: 0.25 })).toBeUndefined()
    expect(outerSillAt(plan(), BASE, { x: 5, y: 4.5, z: 0.1 })).toBeUndefined()
    expect(outerSillAt(plan(), BASE, { x: 6, y: 3.9, z: 0.1 })).toBeUndefined()
  })
})

describe('followWindows and dropOrphanWallPots', () => {
  const twoWindows = () => plan(rect(0, 0, 10, 6), [win({ t: 0.3 }), win({ t: 0.7 })])
  const withBoxes = (p: Plan): Plan => ({ ...p, furniture: [windowBoxAt(p, BASE, 0, 'basil')!, windowBoxAt(p, BASE, 1, 'geranium')!, { kind: 'sofa', x: 2, z: 3, rot: 0 }] })

  it('moves a window box with its moved window and keeps the rest', () => {
    const before = withBoxes(twoWindows())
    const after: Plan = { ...before, windows: [win({ t: 0.2, sill: 1.1 }), win({ t: 0.7 })] }
    const list = followWindows(before, after, BASE, (i) => i)!
    expect(list[0]).toEqual(windowBoxAt(after, BASE, 0, 'basil'))
    expect(list[0].x).toBeCloseTo(2)
    expect(list.slice(1)).toEqual(before.furniture!.slice(1))
  })

  it('drops the box of a deleted window and follows the others to their new index', () => {
    const before = withBoxes(twoWindows())
    const after: Plan = { ...before, windows: [win({ t: 0.7 })] }
    const list = followWindows(before, after, BASE, (i) => (i === 0 ? undefined : i - 1))!
    expect(list.map((f) => f.plant ?? f.kind)).toEqual(['geranium', 'sofa'])
    expect(list[0]).toEqual(windowBoxAt(after, BASE, 0, 'geranium'))
  })

  it('leaves a box that was moved off its window', () => {
    const before = withBoxes(twoWindows())
    before.furniture![0] = { ...before.furniture![0], x: before.furniture![0].x + 0.5 }
    const after: Plan = { ...before, windows: [win({ t: 0.7 })] }
    expect(followWindows(before, after, BASE, (i) => (i === 0 ? undefined : i - 1))![0]).toBe(before.furniture![0])
  })

  it('drops a wall planter with its wall, and keeps one on the facade', () => {
    const p = plan()
    const onWall = wallPotAt(wallFaceAt(p, { x: 4.05, z: 2 }, { x: 5, z: 2 }, 0.05)!, BASE, 3, 'pothos')
    const onFacade = wallPotAt(wallFaceAt(p, { x: 6, z: 0.3 }, { x: 6, z: 1 }, 0.05)!, BASE, 3, 'fern')
    const before: Plan = { ...p, furniture: [onWall, onFacade] }
    expect(dropOrphanWallPots(before, before)).toEqual([onWall, onFacade])
    expect(dropOrphanWallPots(before, { ...before, walls: [] })).toEqual([onFacade])
  })
})
