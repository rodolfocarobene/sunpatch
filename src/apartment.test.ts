import { describe, expect, it } from 'vitest'
import { apartmentGeometry, edgeOpenings, facadeWall, facadeWalls, interiorWalls, remainderRanges, restOfFloorPolygons, wallFrame } from './apartment'
import type { Building, Point } from './osm'
import { FACADE_THICKNESS, SLAB_THICKNESS, type Plan, type Window } from './plan'

const rect = (x0: number, z0: number, x1: number, z1: number): Point[] => [
  { x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 },
]
const ccw = (ring: Point[]) => [...ring].reverse()

const floorPlan = (outer: Point[], holes: Point[][] = [], windows: Window[] = []): Plan => ({
  version: 1,
  buildingId: 'way/1',
  origin: { lat: 45, lon: 9 },
  floor: 1,
  floorHeight: 3,
  outline: { outer, holes },
  walls: [],
  windows,
})
const win = (over: Partial<Window> = {}): Window => ({ ring: 0, edge: 0, t: 0.5, width: 1.2, sill: 0.9, height: 1.4, ...over })

function bounds(g: { computeBoundingBox(): void; boundingBox: any }) {
  g.computeBoundingBox()
  return g.boundingBox
}

// rect(): (0,0) -> (10,0) -> (10,6) -> (0,6) is clockwise in (x, z) (positive area); reversed is the other way.
const outer = rect(0, 0, 10, 6)
const building: Building = { id: 'way/1', outer, holes: [], minHeight: 0, height: 12, heightSource: 'tag', tags: {} }

describe('edgeOpenings', () => {
  it('centres a window on the edge with sill and height', () => {
    const [o] = edgeOpenings(floorPlan(outer, [], [win()]), 0, 0, 10, 2.7)
    expect(o.u0).toBeCloseTo(4.4)
    expect(o.u1).toBeCloseTo(5.6)
    expect(o.v0).toBeCloseTo(0.9)
    expect(o.v1).toBeCloseTo(2.3)
  })

  it('drops windows that overrun the edge or collide with the previous one', () => {
    const windows = [win({ t: 0.02 }), win({ t: 0.98 }), win({ t: 0.3 }), win({ t: 0.32 }), win({ edge: 1 })]
    expect(edgeOpenings(floorPlan(outer, [], windows), 0, 0, 10, 2.7)).toHaveLength(1)
  })

  it('drops windows taller than the wall and clamps ones that only touch the ceiling', () => {
    const plan = floorPlan(outer, [], [win({ sill: 2.6, height: 1 }), win({ t: 0.2, sill: 1, height: 1.7 })])
    const [o] = edgeOpenings(plan, 0, 0, 10, 2.7)
    expect(o.v1).toBeLessThan(2.7)
  })
})

describe('wall placement', () => {
  const zRange = (plan: Plan, ring: number, edge: number) => {
    const b = bounds(facadeWall(plan, building, ring, edge)!.wall)
    return [b.min.z, b.max.z]
  }

  it('puts the wall inside the outline whatever the winding', () => {
    for (const ring of [outer, ccw(outer)]) {
      const plan = floorPlan(ring)
      const n = ring.length
      for (let e = 0; e < n; e++) {
        const b = bounds(facadeWall(plan, building, 0, e)!.wall)
        const centre = { x: (b.min.x + b.max.x) / 2, z: (b.min.z + b.max.z) / 2 }
        // wall centre lies FACADE_THICKNESS/2 inside the edge: inside the rectangle, near the edge
        expect(centre.x).toBeGreaterThan(0)
        expect(centre.x).toBeLessThan(10)
        expect(centre.z).toBeGreaterThan(0)
        expect(centre.z).toBeLessThan(6)
      }
      const [z0, z1] = zRange(plan, 0, ring === outer ? 0 : 2)
      expect(z0).toBeCloseTo(0)
      expect(z1).toBeCloseTo(FACADE_THICKNESS)
    }
  })

  it('builds hole walls on the outside of the hole', () => {
    const hole = rect(4, 2, 6, 4)
    for (const h of [hole, ccw(hole)]) {
      const plan = floorPlan(outer, [h])
      const walls = [0, 1, 2, 3].map((e) => bounds(facadeWall(plan, building, 1, e)!.wall))
      for (const b of walls) {
        // never intrudes into the hole interior (4..6 x 2..4) beyond the overlap at corners
        const overlapX = Math.min(b.max.x, 6) - Math.max(b.min.x, 4)
        const overlapZ = Math.min(b.max.z, 4) - Math.max(b.min.z, 2)
        expect(Math.min(overlapX, overlapZ)).toBeLessThan(1e-6)
      }
      const spanX = Math.min(...walls.map((b) => b.min.x))
      expect(spanX).toBeCloseTo(4 - FACADE_THICKNESS)
    }
  })

  it('extends only at reflex corners', () => {
    const l = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 4 }, { x: 4, z: 4 }, { x: 4, z: 8 }, { x: 0, z: 8 }]
    const frames = l.map((_, e) => wallFrame(floorPlan(l), 0, e)!)
    // reflex vertex is (4, 4): the end of edge 2 and the start of edge 3
    expect(frames.map((f) => [f.extendStart, f.extendEnd])).toEqual([
      [false, false], [false, false], [false, true], [true, false], [false, false], [false, false],
    ])
  })
})

describe('facade wall with windows', () => {
  const plan = floorPlan(outer, [], [win({ t: 0.5 })])
  const { wall, glass } = facadeWall(plan, building, 0, 0)!

  it('spans the floor to the underside of the ceiling slab', () => {
    const b = bounds(wall)
    expect(b.min.y).toBeCloseTo(3)
    expect(b.max.y).toBeCloseTo(3 + 3 - SLAB_THICKNESS)
  })

  it('has one glass pane sitting in the opening', () => {
    expect(glass).toHaveLength(1)
    const b = bounds(glass[0])
    expect(b.min.x).toBeCloseTo(4.4)
    expect(b.max.x).toBeCloseTo(5.6)
    expect(b.min.y).toBeCloseTo(3 + 0.9)
    expect(b.max.y).toBeCloseTo(3 + 2.3)
    expect(b.min.z).toBeCloseTo(FACADE_THICKNESS / 2)
  })

  it('leaves the opening empty (no vertex strictly inside it)', () => {
    const pos = wall.getAttribute('position')
    for (let i = 0; i < pos.count; i++) {
      const inside = pos.getX(i) > 4.4 + 1e-6 && pos.getX(i) < 5.6 - 1e-6 && pos.getY(i) > 3.9 + 1e-6 && pos.getY(i) < 5.3 - 1e-6
      expect(inside).toBe(false)
    }
  })

  it('puts the same opening at the same place on reversed rings', () => {
    const rev = floorPlan(ccw(outer), [], [win({ edge: 2, t: 0.25 })])
    // ccw(outer) edge 2 runs (10,0) -> (0,0)... t = 0.25 from x = 10 means centre x = 7.5
    const g = facadeWall(rev, building, 0, 2)!.glass[0]
    const b = bounds(g)
    expect((b.min.x + b.max.x) / 2).toBeCloseTo(7.5)
  })

  it('builds every edge and skips none for a plain rectangle', () => {
    expect(facadeWalls(plan, building).walls).toHaveLength(4)
    expect(facadeWalls(plan, building).glass).toHaveLength(1)
  })
})

describe('interiorWalls', () => {
  it('builds a box along a to b of the given thickness', () => {
    const plan = floorPlan(outer)
    plan.walls = [{ a: { x: 2, z: 3 }, b: { x: 8, z: 3 }, thickness: 0.2 }]
    const b = bounds(interiorWalls(plan, building)[0])
    expect([b.min.x, b.max.x]).toEqual([2, 8].map((v) => expect.closeTo(v)))
    expect([b.min.z, b.max.z]).toEqual([2.9, 3.1].map((v) => expect.closeTo(v)))
    expect(b.min.y).toBeCloseTo(3)
    expect(b.max.y).toBeCloseTo(5.7)
  })
})

describe('remainderRanges', () => {
  const at = (floor: number) => remainderRanges({ ...building, minHeight: 0, height: 9 }, { ...floorPlan(outer), floor })

  it('ground floor has only a thin slab below the floor', () => {
    const r = at(0)
    expect(r.lower[0]).toBeCloseTo(-SLAB_THICKNESS)
    expect(r.lower[1]).toBeCloseTo(0, 1)
    expect(r.upper![0]).toBeCloseTo(3 - SLAB_THICKNESS)
    expect(r.upper![1]).toBe(9)
  })

  it('middle floor keeps the whole block below and above', () => {
    const r = at(1)
    expect(r.lower[0]).toBe(0)
    expect(r.lower[1]).toBeCloseTo(3, 1)
    expect(r.upper![0]).toBeCloseTo(6 - SLAB_THICKNESS)
  })

  it('top floor still gets a roof slab', () => {
    const r = at(2)
    expect(r.upper![0]).toBeCloseTo(9 - SLAB_THICKNESS)
    expect(r.upper![1]).toBe(9)
  })
})

describe('restOfFloorPolygons', () => {
  const b: Building = { ...building, outer, holes: [] }

  it('is empty when the plan covers the whole footprint', () => {
    expect(restOfFloorPolygons(b, floorPlan(outer))).toEqual([])
    expect(restOfFloorPolygons(b, floorPlan(ccw(outer)))).toEqual([])
  })

  it('is the other half for a half plan', () => {
    const rest = restOfFloorPolygons(b, floorPlan(rect(0, 0, 5, 6)))
    expect(rest).toHaveLength(1)
    const xs = rest[0].outer.map((p) => p.x)
    expect(Math.min(...xs)).toBeCloseTo(5)
    expect(Math.max(...xs)).toBeCloseTo(10)
  })

  it('keeps a courtyard of the footprint as a hole of the rest', () => {
    const withHole: Building = { ...b, holes: [rect(4, 2, 6, 4)] }
    const rest = restOfFloorPolygons(withHole, floorPlan(rect(0, 0, 3, 6)))
    expect(rest).toHaveLength(1)
    expect(rest[0].holes).toHaveLength(1)
  })

  it('drops slivers', () => {
    expect(restOfFloorPolygons(b, floorPlan(rect(0, 0, 10, 5.996)))).toEqual([])
  })
})

describe('apartmentGeometry', () => {
  const b: Building = { ...building, height: 9 }

  it('stacks floor slab, walls and rest of floor on the right heights', () => {
    const g = apartmentGeometry(b, floorPlan(rect(0, 0, 5, 6)))
    const box = (x: any) => bounds(x)
    expect(box(g.floor).max.y).toBeCloseTo(3)
    expect(g.shell).toHaveLength(2)
    expect(box(g.shell[1]).min.y).toBeCloseTo(3)
    expect(box(g.shell[1]).max.y).toBeCloseTo(6 - SLAB_THICKNESS)
    expect(g.ceiling).toHaveLength(1)
    expect(g.walls).toHaveLength(4)
  })

  it('applies edits: adds below/above the ceiling, cuts through the blocks and the rest of the floor', () => {
    const plan = floorPlan(rect(0, 0, 5, 6))
    plan.edits = [
      { kind: 'add', outline: rect(5, 0, 7, 3), bottom: 3, top: 3.3 },
      { kind: 'add', outline: rect(5, 3, 7, 6), bottom: 6, top: 6.3 },
      { kind: 'cut', outline: rect(6, 0, 10, 6), bottom: 4, top: 8 },
    ]
    const g = apartmentGeometry(b, plan)
    expect(g.added).toHaveLength(1)
    expect(g.addedAbove).toHaveLength(1)
    expect(bounds(g.addedAbove[0]).min.y).toBeCloseTo(6)
    // lower block 0..2.98 (whole), rest of floor 3..5.7 split at 4 and 5.7, upper block 5.7..9 split at 8
    expect(g.shell).toHaveLength(1 + 2)
    expect(g.ceiling).toHaveLength(2)
  })
})

describe('apartmentGeometry of a selection made of several pieces', () => {
  // A 21 m wing beside a 6 m wing, and a volume floating above the low one (6 to 12 m).
  const tall: Building = { ...building, id: 'way/2', outer: rect(0, 0, 10, 6), height: 21 }
  const low: Building = { ...building, id: 'way/3', outer: rect(10, 0, 20, 6), height: 6 }
  const floating: Building = { ...building, id: 'way/4', outer: rect(10, 0, 20, 6), minHeight: 6, height: 12 }
  const merged: Building = {
    ...building, outer: rect(0, 0, 20, 6), height: 21, members: [tall, low, floating], sources: ['way/2', 'way/3', 'way/4'],
  }
  const tops = (list: { computeBoundingBox(): void; boundingBox: any }[]) => list.map((g) => bounds(g).max.y)
  // Apartment on floor 1 (y 3 to 6) in the tall wing.
  const g = apartmentGeometry(merged, floorPlan(rect(0, 0, 10, 6)))

  it('sends everything above the ceiling slab to the ceiling, whichever piece it belongs to', () => {
    expect(tops(g.ceiling).sort((a, b) => a - b)).toEqual([6, 12, 21].map((y) => expect.closeTo(y)))
    for (const geometry of g.ceiling) expect(bounds(geometry).min.y).toBeGreaterThanOrEqual(6 - SLAB_THICKNESS - 1e-6)
  })

  it('keeps the low wing visible up to the apartment ceiling', () => {
    const lowWing = g.shell.filter((s) => bounds(s).min.x >= 10 - 1e-6)
    expect(lowWing.length).toBeGreaterThan(0)
    expect(Math.max(...tops(lowWing))).toBeLessThanOrEqual(6 - SLAB_THICKNESS + 1e-6)
  })

  it('a single building without members is cut exactly as before', () => {
    const single = apartmentGeometry({ ...building, height: 9 }, floorPlan(rect(0, 0, 5, 6)))
    expect(single.shell).toHaveLength(2)
    expect(single.ceiling).toHaveLength(1)
  })
})
