import { describe, expect, it } from 'vitest'
import type { Point } from './osm'
import { FACADE_THICKNESS, type Plan, type Window } from './plan'
import {
  bandMarker, headingDeg, isWalkable, movePosition, relativeBearing, resolvePosition, startPosition, walkStart, windowYaw, yawOf,
} from './walk-geom'

const rect = (x0: number, z0: number, x1: number, z1: number): Point[] => [
  { x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 },
]
const planOf = (outer: Point[], over: Partial<Plan> = {}): Plan => ({
  version: 1,
  buildingId: 'way/1',
  origin: { lat: 45, lon: 9 },
  floor: 0,
  floorHeight: 3,
  outline: { outer, holes: [] },
  walls: [],
  windows: [],
  ...over,
})
const win = (over: Partial<Window>): Window => ({ ring: 0, edge: 0, t: 0.5, width: 1.2, sill: 0.9, height: 1.4, ...over })

const room = planOf(rect(0, 0, 10, 6))
const R = 0.25

describe('movePosition', () => {
  it('moves freely in the open', () => {
    const p = movePosition(room, { x: 5, z: 3 }, { x: 6, z: 3 })
    expect(p.x).toBeCloseTo(6)
    expect(p.z).toBeCloseTo(3)
  })

  it('stops at the inner face of a facade wall', () => {
    const p = movePosition(room, { x: 5, z: 3 }, { x: 5, z: -4 })
    expect(p.z).toBeCloseTo(FACADE_THICKNESS + R, 3)
    expect(p.x).toBeCloseTo(5)
  })

  it('slides along a wall instead of stopping', () => {
    const p = movePosition(room, { x: 5, z: 0.6 }, { x: 8, z: -2 })
    expect(p.x).toBeGreaterThan(5)
    expect(p.z).toBeGreaterThanOrEqual(FACADE_THICKNESS + R - 1e-6)
  })

  it('does not tunnel through a thin interior wall in one large step', () => {
    const plan = planOf(rect(0, 0, 10, 6), { walls: [{ a: { x: 5, z: 0 }, b: { x: 5, z: 6 }, thickness: 0.1 }] })
    const p = movePosition(plan, { x: 4, z: 3 }, { x: 7, z: 3 })
    expect(p.x).toBeCloseTo(5 - 0.05 - R, 3)
  })

  it('walks around the end of an interior wall', () => {
    const plan = planOf(rect(0, 0, 10, 6), { walls: [{ a: { x: 5, z: 0 }, b: { x: 5, z: 3 }, thickness: 0.1 }] })
    const p = movePosition(plan, { x: 4, z: 4 }, { x: 7, z: 4 })
    expect(p.x).toBeCloseTo(7)
  })

  it('stays inside a concave outline', () => {
    const l: Point[] = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 3 }, { x: 4, z: 3 }, { x: 4, z: 8 }, { x: 0, z: 8 }]
    let p = { x: 8, z: 1.5 }
    for (let i = 0; i < 40; i++) p = movePosition(planOf(l), p, { x: p.x - 0.3, z: p.z + 0.3 })
    expect(isWalkable(planOf(l), p)).toBe(true)
  })

  it('keeps out of a hole (courtyard)', () => {
    const plan = planOf(rect(0, 0, 10, 10), { outline: { outer: rect(0, 0, 10, 10), holes: [rect(4, 4, 6, 6)] } })
    const p = movePosition(plan, { x: 2, z: 5 }, { x: 8, z: 5 })
    expect(p.x).toBeLessThan(4 - FACADE_THICKNESS - R + 1e-6)
  })
})

describe('resolvePosition', () => {
  it('pushes a point inside a wall back out', () => {
    const p = resolvePosition(room, { x: 5, z: 0.1 })!
    expect(p.z).toBeCloseTo(FACADE_THICKNESS + R, 3)
  })

  it('rejects a point outside the outline', () => {
    expect(resolvePosition(room, { x: 5, z: -3 })).toBeUndefined()
  })
})

describe('startPosition', () => {
  it('uses the centroid when it is clear', () => {
    const p = startPosition(room)
    expect(p.x).toBeCloseTo(5)
    expect(p.z).toBeCloseTo(3)
  })

  it('moves off a wall that passes through the centroid', () => {
    const plan = planOf(rect(0, 0, 10, 6), { walls: [{ a: { x: 5, z: 0 }, b: { x: 5, z: 6 }, thickness: 0.1 }] })
    const p = startPosition(plan)
    expect(isWalkable(plan, p, 0.5)).toBe(true)
    expect(Math.abs(p.x - 5)).toBeLessThan(1.5)
  })

  it('finds a point inside a U-shaped outline whose centroid is outside', () => {
    const u: Point[] = [
      { x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 7, z: 10 }, { x: 7, z: 3 },
      { x: 3, z: 3 }, { x: 3, z: 10 }, { x: 0, z: 10 },
    ]
    const plan = planOf(u)
    expect(isWalkable(plan, startPosition(plan), 0.5)).toBe(true)
  })
})

describe('windowYaw', () => {
  it('looks toward the edge with the most window width', () => {
    // Edge 2 is the south edge (z = 6): looking south is yaw 180 degrees.
    const plan = planOf(rect(0, 0, 10, 6), {
      windows: [win({ edge: 2, t: 0.3 }), win({ edge: 2, t: 0.7 }), win({ edge: 1 })],
    })
    expect(Math.abs(windowYaw(plan, { x: 5, z: 3 }))).toBeCloseTo(Math.PI, 5)
  })

  it('defaults to north without windows', () => {
    expect(windowYaw(room, { x: 5, z: 3 })).toBe(0)
  })
})

describe('yawOf', () => {
  it('maps compass directions', () => {
    expect(yawOf(0, -1)).toBeCloseTo(0)
    expect(yawOf(-1, 0)).toBeCloseTo(Math.PI / 2) // west is counter-clockwise from north
    expect(yawOf(1, 0)).toBeCloseTo(-Math.PI / 2)
  })
})

describe('walkStart', () => {
  const withWindow = planOf(rect(0, 0, 10, 6), { windows: [win({ edge: 2 })] })

  it('uses the viewpoint when it is walkable', () => {
    const plan = { ...withWindow, viewpoint: { x: 2, z: 2, yaw: 1.25 } }
    expect(walkStart(plan)).toEqual({ pos: { x: 2, z: 2 }, yaw: 1.25 })
  })

  it('falls back to the automatic start when the viewpoint is outside', () => {
    const plan = { ...withWindow, viewpoint: { x: 20, z: 2, yaw: 1.25 } }
    expect(walkStart(plan)).toEqual({ pos: startPosition(plan), yaw: windowYaw(plan, startPosition(plan)) })
  })

  it('starts at a clicked point whatever the viewpoint', () => {
    const plan = { ...withWindow, viewpoint: { x: 2, z: 2, yaw: 1.25 } }
    const { pos, yaw } = walkStart(plan, { x: 8, z: 3 })
    expect(pos).toEqual({ x: 8, z: 3 })
    expect(yaw).toBeCloseTo(windowYaw(plan, pos))
  })
})

describe('sun direction band', () => {
  const sunAt = (yaw: number, azimuth: number) => relativeBearing(headingDeg(yaw), azimuth)

  it('converts a yaw to a clockwise compass heading', () => {
    expect(headingDeg(0)).toBeCloseTo(0)
    expect(headingDeg(Math.PI / 2)).toBeCloseTo(270) // turned left from north: west
    expect(headingDeg(-Math.PI / 2)).toBeCloseTo(90)
    expect(headingDeg(yawOf(0, 1))).toBeCloseTo(180) // looking south
    expect(headingDeg(4 * Math.PI)).toBeCloseTo(0)
  })

  it('is 0 when the sun is ahead and positive to the right', () => {
    expect(sunAt(yawOf(1, 0), 90)).toBeCloseTo(0) // looking east, sun in the east
    expect(sunAt(0, 45)).toBeCloseTo(45) // looking north, sun north-east: right
    expect(sunAt(0, 315)).toBeCloseTo(-45)
  })

  it('wraps around north', () => {
    expect(relativeBearing(350, 10)).toBe(20)
    expect(relativeBearing(10, 350)).toBe(-20)
    expect(relativeBearing(720, 350)).toBe(-10)
    expect(relativeBearing(0, 360)).toBe(0)
  })

  it('puts the sun behind at 180', () => {
    expect(relativeBearing(0, 180)).toBe(180)
    expect(relativeBearing(90, 270)).toBe(180)
  })

  it('clamps outside the band and flags it', () => {
    expect(bandMarker(45, 90)).toEqual({ offset: 0.5, clamped: false })
    expect(bandMarker(-90, 90)).toEqual({ offset: -1, clamped: false })
    expect(bandMarker(120, 90)).toEqual({ offset: 1, clamped: true })
    expect(bandMarker(-180, 90)).toEqual({ offset: -1, clamped: true })
  })
})
