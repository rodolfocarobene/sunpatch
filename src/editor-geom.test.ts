import { describe, expect, it } from 'vitest'
import {
  clampWindowT,
  clampWindowVertical,
  normalizeWindows,
  placeWindowT,
  WINDOW_CLEARANCE,
  WINDOW_GAP,
  WINDOW_VERTICAL_MARGIN,
  constrainToDirections,
  distanceToSegment,
  fitBounds,
  nearestEdge,
  projectOnSegment,
  ringSegments,
  selfIntersects,
  snapPoint,
  validatePlan,
} from './editor-geom'
import type { Point } from './osm'
import type { Plan } from './plan'

const sq = [
  { x: 0, z: 0 },
  { x: 10, z: 0 },
  { x: 10, z: 10 },
  { x: 0, z: 10 },
]

describe('projectOnSegment', () => {
  it('projects inside and clamps outside', () => {
    expect(projectOnSegment({ x: 4, z: 3 }, sq[0], sq[1])).toMatchObject({ t: 0.4, dist: 3 })
    expect(projectOnSegment({ x: -5, z: 0 }, sq[0], sq[1]).t).toBe(0)
    expect(projectOnSegment({ x: 50, z: 0 }, sq[0], sq[1]).t).toBe(1)
  })
  it('handles a degenerate segment', () => {
    expect(projectOnSegment({ x: 1, z: 1 }, sq[0], sq[0]).dist).toBeCloseTo(Math.SQRT2)
  })
  it('distanceToSegment', () => {
    expect(distanceToSegment({ x: 12, z: 5 }, sq[1], sq[2])).toBe(2)
  })
})

describe('snapPoint', () => {
  const segs = ringSegments(sq)
  it('prefers vertices over edges', () => {
    expect(snapPoint({ x: 0.3, z: 0.2 }, sq, segs, 0.5)).toEqual({ point: { x: 0, z: 0 }, kind: 'vertex' })
  })
  it('falls back to the edge', () => {
    expect(snapPoint({ x: 5, z: 0.2 }, sq, segs, 0.5)).toEqual({ point: { x: 5, z: 0 }, kind: 'edge' })
  })
  it('leaves far points alone', () => {
    expect(snapPoint({ x: 5, z: 5 }, sq, segs, 0.5)).toEqual({ point: { x: 5, z: 5 }, kind: 'none' })
  })
})

describe('nearestEdge', () => {
  it('reports ring and edge index', () => {
    const hole = [
      { x: 3, z: 3 },
      { x: 6, z: 3 },
      { x: 6, z: 6 },
    ]
    expect(nearestEdge([sq, hole], { x: 4.5, z: 3.1 }, 0.5)).toMatchObject({ ring: 1, edge: 0, t: 0.5 })
    expect(nearestEdge([sq, hole], { x: 5, z: 8 }, 0.5)).toBeUndefined()
  })
})

describe('clampWindowT', () => {
  it('keeps the window inside the edge and clear of its ends', () => {
    expect(clampWindowT(0, 2, 10)).toBeCloseTo((WINDOW_CLEARANCE + 1) / 10)
    expect(clampWindowT(1, 2, 10)).toBeCloseTo(1 - (WINDOW_CLEARANCE + 1) / 10)
    expect(clampWindowT(0.5, 2, 10)).toBe(0.5)
  })
  it('rejects edges too short once the clearance is kept', () => {
    expect(clampWindowT(0.5, 1.2, 1)).toBeNull()
    expect(clampWindowT(0.5, 1.2, 1.7)).toBeNull()
    expect(clampWindowT(0.5, 1.2, 1.8)).toBeCloseTo(0.5)
  })
})

describe('placeWindowT', () => {
  const others = [{ t: 0.5, width: 2 }]
  it('moves a window out of a neighbour to the nearest free spot', () => {
    const t = placeWindowT(0.52, 1.2, 10, others)!
    const u0 = t * 10 - 0.6
    expect(u0).toBeGreaterThanOrEqual(6 + WINDOW_GAP - 1e-9)
    expect(t).toBeGreaterThan(0.5)
  })
  it('picks the side the cursor is on', () => {
    expect(placeWindowT(0.45, 1.2, 10, others)!).toBeLessThan(0.5)
  })
  it('returns null when nothing fits between the others and the ends', () => {
    expect(placeWindowT(0.5, 1.2, 4, [{ t: 0.5, width: 1.5 }])).toBeNull()
  })
  it('lets two windows sit side by side with the gap', () => {
    const t = placeWindowT(0.55, 1.2, 10, [{ t: 0.5, width: 1.2 }])!
    expect(t * 10 - 0.6 - (5 + 0.6)).toBeCloseTo(WINDOW_GAP)
  })
})

describe('clampWindowVertical', () => {
  it('keeps sill + height under the ceiling slab', () => {
    const r = clampWindowVertical(2, 1.4, 2.7)
    expect(r.sill + r.height).toBeLessThanOrEqual(2.7 - WINDOW_VERTICAL_MARGIN + 1e-9)
    expect(r.height).toBeGreaterThanOrEqual(0.2)
  })
  it('leaves a window that fits alone', () => {
    expect(clampWindowVertical(0.9, 1.4, 2.7)).toEqual({ sill: 0.9, height: 1.4 })
  })
  it('lifts a sill off the floor', () => {
    expect(clampWindowVertical(0, 1, 2.7).sill).toBe(WINDOW_VERTICAL_MARGIN)
  })
})

describe('normalizeWindows', () => {
  const sq: Point[] = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 6 }, { x: 0, z: 6 }]
  const w = (over: object) => ({ ring: 0, edge: 0, t: 0.5, width: 1.2, sill: 0.9, height: 1.4, ...over })
  const plan = (windows: object[]) => ({ floorHeight: 3, outline: { outer: sq, holes: [] }, windows }) as unknown as Plan

  it('moves flush, overrunning and overlapping windows to valid places', () => {
    const p = normalizeWindows(plan([w({ t: 0 }), w({ t: 0.02 }), w({ t: 1 }), w({ edge: 1, sill: 2.5, height: 2 })]))
    const [a, b, c, d] = p.windows
    expect(a.t * 10 - 0.6).toBeGreaterThanOrEqual(WINDOW_CLEARANCE - 1e-9)
    expect(b.t * 10 - 0.6).toBeGreaterThanOrEqual(a.t * 10 + 0.6 + WINDOW_GAP - 1e-9)
    expect(c.t * 10 + 0.6).toBeLessThanOrEqual(10 - WINDOW_CLEARANCE + 1e-9)
    expect(d.sill + d.height).toBeLessThanOrEqual(2.7)
  })
})

describe('constrainToDirections', () => {
  it('snaps to the closest axis', () => {
    const axes = [{ x: 1, z: 0 }, { x: 0, z: 1 }]
    expect(constrainToDirections({ x: 0, z: 0 }, { x: 5, z: 1 }, axes)).toEqual({ x: 5, z: 0 })
    expect(constrainToDirections({ x: 0, z: 0 }, { x: 1, z: -4 }, axes)).toEqual({ x: 0, z: -4 })
  })
})

describe('selfIntersects', () => {
  it('accepts simple polygons', () => {
    expect(selfIntersects(sq)).toBe(false)
  })
  it('rejects a bow tie', () => {
    expect(selfIntersects([sq[0], sq[2], sq[1], sq[3]])).toBe(true)
  })
  it('rejects repeated vertices', () => {
    expect(selfIntersects([sq[0], sq[1], sq[2], sq[1]])).toBe(true)
  })
})

describe('validatePlan', () => {
  const plan: Plan = {
    version: 1,
    buildingId: 'way/1',
    origin: { lat: 45, lon: 9 },
    floor: 1,
    floorHeight: 3,
    outline: { outer: sq, holes: [] },
    walls: [{ a: sq[0], b: sq[2], thickness: 0.1 }],
    windows: [{ ring: 0, edge: 1, t: 0.5, width: 1.2, sill: 0.9, height: 1.4 }],
  }
  it('accepts a valid plan', () => {
    expect(validatePlan(JSON.parse(JSON.stringify(plan)))).toEqual({ plan })
  })
  it('rejects bad input', () => {
    expect(validatePlan(null)).toHaveProperty('error')
    expect(validatePlan({ ...plan, version: 2 })).toHaveProperty('error')
    expect(validatePlan({ ...plan, outline: { outer: sq.slice(0, 2), holes: [] } })).toHaveProperty('error')
    expect(validatePlan({ ...plan, windows: [{ ...plan.windows[0], edge: 9 }] })).toHaveProperty('error')
    expect(validatePlan({ ...plan, walls: [{ a: sq[0], b: sq[1], thickness: 'x' }] })).toHaveProperty('error')
  })
  it('accepts a viewpoint and edits', () => {
    const full: Plan = {
      ...plan,
      viewpoint: { x: 5, z: 5, yaw: 1.2 },
      edits: [{ kind: 'add', outline: sq, bottom: 2.8, top: 3 }, { kind: 'cut', outline: sq, bottom: 0, top: 15 }],
    }
    expect(validatePlan(JSON.parse(JSON.stringify(full)))).toEqual({ plan: full })
  })
  it('rejects a bad viewpoint', () => {
    expect(validatePlan({ ...plan, viewpoint: { x: 1, z: 2 } })).toHaveProperty('error')
    expect(validatePlan({ ...plan, viewpoint: { x: 1, z: NaN, yaw: 0 } })).toHaveProperty('error')
    expect(validatePlan({ ...plan, viewpoint: null })).toHaveProperty('error')
  })
  it('rejects bad edits', () => {
    const e = { kind: 'add', outline: sq, bottom: 0, top: 3 }
    expect(validatePlan({ ...plan, edits: 'x' })).toHaveProperty('error')
    expect(validatePlan({ ...plan, edits: [{ ...e, kind: 'raise' }] })).toHaveProperty('error')
    expect(validatePlan({ ...plan, edits: [{ ...e, outline: sq.slice(0, 2) }] })).toHaveProperty('error')
    expect(validatePlan({ ...plan, edits: [{ ...e, bottom: 3 }] })).toHaveProperty('error')
    expect(validatePlan({ ...plan, edits: [{ ...e, top: Infinity }] })).toHaveProperty('error')
  })
})

describe('fitBounds', () => {
  const square = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }]
  const limits = { min: 1, max: 400 }

  it('centres the bounds in the free area', () => {
    const free = { left: 300, right: 300, top: 50, bottom: 50 }
    const v = fitBounds(square, 1400, 900, free, limits)
    // symmetric margins: the view centre is the bounds' centre
    expect(v.cx).toBeCloseTo(5)
    expect(v.cz).toBeCloseTo(5)
    // limited by height: 800 px * 0.85 / 10 m
    expect(v.scale).toBeCloseTo(68)
  })

  it('shifts the centre when the free area is off-centre', () => {
    const v = fitBounds(square, 1000, 800, { left: 400, right: 0, top: 0, bottom: 0 }, limits)
    // the bounds' centre sits at x = 700 px, i.e. 200 px right of the canvas centre
    expect(5 - v.cx).toBeCloseTo(200 / v.scale)
  })

  it('clamps the scale to the limits', () => {
    const tiny = [{ x: 0, z: 0 }, { x: 0.1, z: 0.1 }]
    expect(fitBounds(tiny, 1000, 800, { left: 0, right: 0, top: 0, bottom: 0 }, limits).scale).toBeLessThanOrEqual(400)
    const huge = [{ x: 0, z: 0 }, { x: 5000, z: 5000 }]
    expect(fitBounds(huge, 1000, 800, { left: 0, right: 0, top: 0, bottom: 0 }, limits).scale).toBe(1)
  })
})
