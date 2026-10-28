import { describe, expect, it } from 'vitest'
import {
  clampWindowT,
  constrainToDirections,
  distanceToSegment,
  nearestEdge,
  projectOnSegment,
  ringSegments,
  selfIntersects,
  snapPoint,
  validatePlan,
} from './editor-geom'
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
  it('keeps the window inside the edge', () => {
    expect(clampWindowT(0, 2, 10)).toBeCloseTo(0.1)
    expect(clampWindowT(1, 2, 10)).toBeCloseTo(0.9)
    expect(clampWindowT(0.5, 2, 10)).toBe(0.5)
  })
  it('rejects too short edges', () => {
    expect(clampWindowT(0.5, 1.2, 1)).toBeNull()
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
