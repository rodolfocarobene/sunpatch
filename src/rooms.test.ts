import { describe, expect, it } from 'vitest'
import { facadeWall } from './apartment'
import { internalReflected, roomSurfaces } from './dayfactor'
import { trianglesArea, glassTriangles } from './dayfactor-trace'
import type { Building, Point } from './osm'
import type { InteriorWall, Plan, Window } from './plan'
import { buildRooms, ircAt, roomIrc } from './rooms'

const rect = (w: number, d: number): Point[] => [{ x: 0, z: 0 }, { x: w, z: 0 }, { x: w, z: d }, { x: 0, z: d }]
const wall = (ax: number, az: number, bx: number, bz: number, thickness = 0.1): InteriorWall => ({ a: { x: ax, z: az }, b: { x: bx, z: bz }, thickness })
const planOf = (outer: Point[], walls: InteriorWall[] = [], windows: Window[] = [], holes: Point[][] = []): Plan => ({
  version: 1, buildingId: 'way/1', origin: { lat: 45, lon: 9 }, floor: 0, floorHeight: 3, outline: { outer, holes }, walls, windows, panels: [],
})
// Edges of rect(): 0 north (z = 0), 1 east, 2 south (z = depth, running west), 3 west.
const win = (edge: number, t = 0.5, ring = 0): Window => ({ ring, edge, t, width: 1.2, sill: 0.9, height: 1.4 })

describe('room partition', () => {
  it('keeps an empty apartment as one room', () => {
    const rooms = buildRooms(planOf(rect(8, 5)))
    expect(rooms.rooms).toHaveLength(1)
    expect(rooms.rooms[0].floor).toBeCloseTo(40, 6)
  })

  it('splits two rooms by a wall that spans the apartment', () => {
    const rooms = buildRooms(planOf(rect(8, 5), [wall(4, 0, 4, 5)]))
    expect(rooms.rooms).toHaveLength(2)
    expect(rooms.roomAt(2, 2.5)).not.toBe(rooms.roomAt(6, 2.5))
    const [a, b] = rooms.rooms
    expect(a.floor + b.floor).toBeCloseTo(40, 6)
    // Facade 26 m plus the interior wall's two faces, 5 m each; the sampling skips the stretches of facade
    // within the closing band of the wall's ends (a few percent short).
    expect(Math.abs(a.walls + b.walls - (26 + 10) * 3)).toBeLessThan(3)
  })

  it('joins the rooms through a 1 m doorway', () => {
    expect(buildRooms(planOf(rect(8, 5), [wall(4, 0, 4, 2), wall(4, 3, 4, 5)])).rooms).toHaveLength(1)
  })

  it('closes a 0.1 m drawing gap between walls, and one between a wall and the outline', () => {
    expect(buildRooms(planOf(rect(8, 5), [wall(4, 0, 4, 2.45), wall(4, 2.55, 4, 5)])).rooms).toHaveLength(2)
    expect(buildRooms(planOf(rect(8, 5), [wall(4, 0.1, 4, 4.9)])).rooms).toHaveLength(2)
  })

  it('leaves a gap of 0.4 m to the outline open: a doorway', () => {
    expect(buildRooms(planOf(rect(8, 5), [wall(4, 0.4, 4, 5)])).rooms).toHaveLength(1)
  })

  it('splits an L-shaped outline by a wall across one arm', () => {
    const l: Point[] = [{ x: 0, z: 0 }, { x: 8, z: 0 }, { x: 8, z: 3 }, { x: 3, z: 3 }, { x: 3, z: 8 }, { x: 0, z: 8 }]
    expect(buildRooms(planOf(l)).rooms).toHaveLength(1)
    const split = buildRooms(planOf(l, [wall(0, 5, 3, 5)]))
    expect(split.rooms).toHaveLength(2)
    expect(split.rooms[0].floor + split.rooms[1].floor).toBeCloseTo(8 * 3 + 3 * 5, 6)
    expect(split.roomAt(1.5, 7)).not.toBe(split.roomAt(1.5, 1))
  })

  it('does not count a courtyard as floor, and a point inside it takes the nearest room', () => {
    const court: Point[] = [{ x: 3, z: 1.5 }, { x: 5, z: 1.5 }, { x: 5, z: 3.5 }, { x: 3, z: 3.5 }]
    const rooms = buildRooms(planOf(rect(8, 5), [], [], [court]))
    expect(rooms.rooms).toHaveLength(1)
    expect(rooms.rooms[0].floor).toBeCloseTo(36, 6)
    expect(rooms.rooms[0].walls).toBeCloseTo((26 + 8) * 3, 0)
    expect(rooms.roomAt(4, 2.5)).toBe(0)
  })

  it('splits a ring around a courtyard with two walls into two rooms', () => {
    const court: Point[] = [{ x: 3, z: 1.5 }, { x: 5, z: 1.5 }, { x: 5, z: 3.5 }, { x: 3, z: 3.5 }]
    const rooms = buildRooms(planOf(rect(8, 5), [wall(4, 0, 4, 1.5), wall(4, 3.5, 4, 5)], [], [court]))
    expect(rooms.rooms).toHaveLength(2)
  })
})

describe('windows and IRC per room', () => {
  // 8 x 5 m with a full wall at x = 4; windows on the south edge at x = 6 and on the east edge: both in the east room.
  const plan = planOf(rect(8, 5), [wall(4, 0, 4, 5)], [win(2, 0.25), win(1)])
  const rooms = buildRooms(plan)
  const west = rooms.roomAt(2, 2.5)
  const east = rooms.roomAt(6, 2.5)

  it('assigns each window to the room its edge looks into', () => {
    expect(rooms.rooms[west].glass).toBe(0)
    expect(rooms.rooms[east].glass).toBeCloseTo(2 * 1.2 * 1.4, 6)
  })

  it('gives a windowless room an IRC of 0 and the lit room a positive one', () => {
    expect(roomIrc(rooms.rooms[west])).toBe(0)
    expect(roomIrc(rooms.rooms[east])).toBeGreaterThan(0)
    expect(ircAt(rooms, 1, 1)).toBe(0)
    expect(ircAt(rooms, 7, 4)).toBeGreaterThan(0)
  })

  it('gives a small room with the same window more IRC than a big one', () => {
    const small = buildRooms(planOf(rect(4, 5), [], [win(2)]))
    const large = buildRooms(planOf(rect(8, 5), [], [win(2)]))
    expect(roomIrc(small.rooms[0])).toBeGreaterThan(roomIrc(large.rooms[0]) * 1.5)
  })

  it('takes a point on the wall, or outside the outline, from the nearest room', () => {
    expect(rooms.roomAt(3.98, 2.5)).toBe(west)
    expect(rooms.roomAt(4.02, 2.5)).toBe(east)
    expect(rooms.roomAt(-3, 2.5)).toBe(west)
    expect(rooms.roomAt(30, 2.5)).toBe(east)
  })
})

describe('a single-room plan is what the whole-apartment formula gave', () => {
  const outer = rect(5, 4)
  const building: Building = { id: 'way/1', outer, holes: [], minHeight: 0, height: 6, heightSource: 'tag', tags: {} }
  const plan = planOf(outer, [], [{ ring: 0, edge: 2, t: 0.5, width: 2, sill: 0.9, height: 1.4 }])
  it('has the same IRC, floor, walls and glass', () => {
    const rooms = buildRooms(plan)
    expect(rooms.rooms).toHaveLength(1)
    const glass = trianglesArea(glassTriangles(facadeWall(plan, building, 0, 2)!.glass))
    const old = internalReflected(glass, roomSurfaces(plan))
    expect(rooms.rooms[0].glass).toBeCloseTo(glass, 6)
    expect(rooms.rooms[0].floor).toBeCloseTo(roomSurfaces(plan).floor, 6)
    expect(rooms.rooms[0].walls).toBeCloseTo(roomSurfaces(plan).walls, 6)
    expect(roomIrc(rooms.rooms[0])).toBeCloseTo(old, 6)
  })
})
