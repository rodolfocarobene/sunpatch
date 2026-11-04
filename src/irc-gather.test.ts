import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { GLAZING, hemisphereDirs, internalReflected, meanReflectance, REFLECTANCE, roomSurfaces } from './dayfactor'
import {
  calibrate, gatherFirstBounce, IrcRun, ircValue, patchCellFor, PatchField, IRC_GATHER_RAYS, IRC_MAX_PATCHES, reflectanceOf, type IrcInput,
} from './irc-gather'
import type { Point } from './osm'
import type { Plan } from './plan'
import { buildRooms, ircInput, roomIrc } from './rooms'
import { buildBvh } from './sunmap-trace'

// Triangle soups (nine numbers each) for small test rooms.
type V = [number, number, number]
const quad = (a: V, b: V, c: V, d: V): number[] => [...a, ...b, ...c, ...a, ...c, ...d]

/** A room x 0..w, z 0..d, y 0..h, closed except for a window in the north wall (z = 0): x wx0..wx1, y wy0..wy1. */
function room(w: number, d: number, h: number, win?: { x0: number; x1: number; y0: number; y1: number }) {
  const t: number[] = []
  t.push(...quad([0, 0, 0], [w, 0, 0], [w, 0, d], [0, 0, d])) // floor
  t.push(...quad([0, h, 0], [0, h, d], [w, h, d], [w, h, 0])) // ceiling
  t.push(...quad([0, 0, d], [w, 0, d], [w, h, d], [0, h, d])) // south
  t.push(...quad([0, 0, 0], [0, 0, d], [0, h, d], [0, h, 0])) // west
  t.push(...quad([w, 0, 0], [w, h, 0], [w, h, d], [w, 0, d])) // east
  const glass: number[] = []
  if (!win) t.push(...quad([0, 0, 0], [w, 0, 0], [w, h, 0], [0, h, 0]))
  else {
    const { x0, x1, y0, y1 } = win
    t.push(...quad([0, 0, 0], [x0, 0, 0], [x0, h, 0], [0, h, 0]))
    t.push(...quad([x1, 0, 0], [w, 0, 0], [w, h, 0], [x1, h, 0]))
    t.push(...quad([x0, 0, 0], [x1, 0, 0], [x1, y0, 0], [x0, y0, 0]))
    t.push(...quad([x0, y1, 0], [x1, y1, 0], [x1, h, 0], [x0, h, 0]))
    glass.push(...quad([x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0]))
  }
  return { occluders: buildBvh(Float32Array.from(t)), glass: buildBvh(Float32Array.from(glass.length ? glass : [900, 900, 900, 901, 900, 900, 900, 901, 900])) }
}

const WORK = 0.85
const dirs = hemisphereDirs(IRC_GATHER_RAYS)

describe('gather normalisation', () => {
  // A disc of uniform luminance L above the point: E = pi L F with F = r2 / (r2 + h2) for a disc centred over the point.
  // The patch light is E_patch = 1, so L = rho E_patch / pi and the first bounce is rho * F.
  function disc(r: number, h: number): number[] {
    const t: number[] = []
    const n = 96
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 2 * Math.PI
      const b = ((i + 1) / n) * 2 * Math.PI
      t.push(0, h, 0, r * Math.cos(b), h, r * Math.sin(b), r * Math.cos(a), h, r * Math.sin(a))
    }
    return t
  }
  const glassFar = buildBvh(Float32Array.from([900, 900, 900, 901, 900, 900, 900, 901, 900]))
  const uniform = { at: () => 1 }

  it('gives a point under an infinite ceiling rho * E (view factor 1)', () => {
    const occluders = buildBvh(Float32Array.from(quad([-1e4, 3, -1e4], [-1e4, 3, 1e4], [1e4, 3, 1e4], [1e4, 3, -1e4])))
    const e1 = gatherFirstBounce(occluders, glassFar, uniform, 0, 1, 0, dirs, 0)
    expect(e1).toBeCloseTo(REFLECTANCE.ceiling, 6) // pi * L with L = 0.7 / pi
  })

  it('scales with the view factor of a finite ceiling: pi L F', () => {
    const occluders = buildBvh(Float32Array.from(disc(2, 2)))
    const e1 = gatherFirstBounce(occluders, glassFar, uniform, 0, 0, 0, dirs, 0)
    expect(e1).toBeCloseTo(REFLECTANCE.ceiling * 0.5, 1) // F = 4 / (4 + 4)
    expect(Math.abs(e1 / (REFLECTANCE.ceiling * 0.5) - 1)).toBeLessThan(0.03)
  })

  it('counts a ray that leaves through a pane as nothing', () => {
    // The ceiling is the only surface and a pane sits under all of it: every ray crosses the pane first.
    const occluders = buildBvh(Float32Array.from(quad([-1e4, 3, -1e4], [-1e4, 3, 1e4], [1e4, 3, 1e4], [1e4, 3, -1e4])))
    const pane = buildBvh(Float32Array.from(quad([-1e4, 2, -1e4], [-1e4, 2, 1e4], [1e4, 2, 1e4], [1e4, 2, -1e4])))
    expect(gatherFirstBounce(occluders, pane, uniform, 0, 1, 0, dirs, 0)).toBe(0)
  })

  it('takes the reflectance from the normal: ceiling, wall, floor', () => {
    expect(reflectanceOf(-1)).toBe(0.7)
    expect(reflectanceOf(0)).toBe(0.5)
    expect(reflectanceOf(1)).toBe(0.3)
  })
})

describe('patch light', () => {
  it('is the CIE share of the sky through the window for a surface that faces it, and 0 for the ceiling (it sees no sky through a window below it)', () => {
    const { occluders, glass } = room(4, 6, 3, { x0: 0.5, x1: 3.5, y0: 0.9, y1: 2.4 })
    const field = new PatchField(occluders, glass, 0.5)
    const backWall = field.at(new Vector3(2, 1.5, 6), new Vector3(0, 0, -1))
    expect(backWall).toBeGreaterThan(0)
    expect(backWall).toBeLessThan(100 * GLAZING)
    expect(field.at(new Vector3(2, 3, 0.5), new Vector3(0, -1, 0))).toBe(0)
    // The floor: brighter near the window than at the back.
    const near = field.at(new Vector3(2, 0, 1), new Vector3(0, 1, 0))
    const far = field.at(new Vector3(2, 0, 5.5), new Vector3(0, 1, 0))
    expect(near).toBeGreaterThan(far)
    // The same patch asked again is the cached value, not a new patch.
    const size = field.size
    expect(field.at(new Vector3(2.1, 1.6, 6), new Vector3(0, 0, -1))).toBe(backWall)
    expect(field.size).toBe(size)
  })

  it('makes no more patches than the cap by coarsening the cell', () => {
    expect(patchCellFor(100)).toBe(0.5)
    const area = 10 * IRC_MAX_PATCHES
    expect(patchCellFor(area) ** 2 * IRC_MAX_PATCHES).toBeCloseTo(area, 6)
  })
})

describe('falloff in a one-window room', () => {
  const w = 4
  const d = 8
  const h = 3
  const { occluders, glass } = room(w, d, h, { x0: 0.5, x1: 3.5, y0: 0.9, y1: 2.4 })
  const field = new PatchField(occluders, glass, 0.5)
  const at = (z: number) => gatherFirstBounce(occluders, glass, field, 2, WORK, z, dirs, 0)

  it('gathers more near the window than mid-room, and more mid-room than at the rear of the room', () => {
    // The wall facing the window is itself lit directly, so within about a metre of it the value rises again (a real effect).
    const near = at(1)
    const mid = at(4)
    const rear = at(6.2)
    expect(near).toBeGreaterThan(mid)
    expect(mid).toBeGreaterThan(rear)
    expect(rear).toBeGreaterThan(0)
  })

  it('keeps the BRE room mean after calibration, with the falloff intact', () => {
    const xs: number[] = []
    const rows: number[] = []
    for (let z = 0.25; z < d; z += 0.5) for (let x = 0.25; x < w; x += 0.5) rows.push(x, z)
    xs.push(...rows)
    const target = 1.7
    const input: IrcInput = {
      floorY: 0,
      rooms: [{ target, reflectance: 0.5 }],
      calib: { points: Float32Array.from(xs), room: new Int32Array(xs.length / 2) },
      area: 2 * w * d + 2 * (w + d) * h,
      cacheKey: 'test',
    }
    const run = new IrcRun(occluders, glass, field, input)
    while (!run.done) run.step(50)
    const irc = run.result()
    const mean = irc.reduce((a, b) => a + b, 0) / irc.length
    expect(mean).toBeCloseTo(target, 3)
    expect(run.rooms[0].scale).toBeGreaterThan(0)
    // Falloff survives the scale: the row nearest the window against the row at the back.
    const rowMean = (z: number) => {
      let s = 0
      let n = 0
      for (let i = 0; i < irc.length; i++) if (Math.abs(input.calib.points[i * 2 + 1] - z) < 0.01) (s += irc[i]), n++
      return s / n
    }
    expect(rowMean(1.25)).toBeGreaterThan(rowMean(4.25))
    expect(rowMean(4.25)).toBeGreaterThan(rowMean(6.25))
  })

  it('reports points other than the calibration points, held to the same scale', () => {
    const calib = Float32Array.from([1, 1, 3, 1, 1, 4, 3, 4, 1, 7, 3, 7])
    const input: IrcInput = {
      floorY: 0, rooms: [{ target: 2, reflectance: 0.5 }], calib: { points: calib, room: new Int32Array(6) }, area: 100, cacheKey: 'k',
    }
    const a = new IrcRun(occluders, glass, field, input)
    while (!a.done) a.step(50)
    const same = a.result()
    const b = new IrcRun(occluders, glass, field, { ...input, points: Float32Array.from([1, 1]), room: new Int32Array(1) }, a.rooms)
    while (!b.done) b.step(50)
    expect(b.result()[0]).toBeCloseTo(same[0], 4)
  })
})

describe('calibration', () => {
  it('holds each room mean to its BRE value, and a room without glass to 0', () => {
    const rooms = [{ target: 2, reflectance: 0.5 }, { target: 0, reflectance: 0.5 }, { target: 1, reflectance: 0.4 }]
    const e1 = [1, 3, 0.5, 0.7, 9, 5, 1, 3]
    const room = [0, 0, 1, 1, 1, 2, 2, 2]
    const cal = calibrate(e1, room, rooms)
    const mean = (k: number) => {
      const v = e1.map((e, i) => (room[i] === k ? ircValue(e, cal[k]) : NaN)).filter((x) => !Number.isNaN(x))
      return v.reduce((a, b) => a + b, 0) / v.length
    }
    expect(mean(0)).toBeCloseTo(2, 9)
    expect(mean(1)).toBe(0)
    expect(mean(2)).toBeCloseTo(1, 9)
    expect(cal[1].scale).toBe(0)
  })

  it('adds the split-flux remainder R / (1 - R) of the first bounce', () => {
    const cal = calibrate([2, 2], [0, 0], [{ target: 1, reflectance: 0.5 }])[0]
    expect(cal.e2).toBeCloseTo(2, 9) // R / (1 - R) = 1
    expect(cal.scale).toBeCloseTo(0.25, 9) // 1 / (2 + 2)
  })

  it('falls back to the uniform BRE value where the gather found no light at all', () => {
    const cal = calibrate([0, 0], [0, 0], [{ target: 1.3, reflectance: 0.5 }])[0]
    expect(ircValue(0, cal)).toBeCloseTo(1.3, 9)
  })
})

describe('single room regression', () => {
  const rect = (w: number, d: number): Point[] => [{ x: 0, z: 0 }, { x: w, z: 0 }, { x: w, z: d }, { x: 0, z: d }]
  const plan: Plan = {
    version: 1, buildingId: 'way/1', origin: { lat: 45, lon: 9 }, floor: 0, floorHeight: 3, outline: { outer: rect(8, 5), holes: [] }, walls: [],
    windows: [{ ring: 0, edge: 0, t: 0.5, width: 2, sill: 0.9, height: 1.4 }], panels: [],
  }

  it('has the whole-apartment BRE value as the target and the room reflectance as R', () => {
    const rooms = buildRooms(plan)
    expect(rooms.rooms).toHaveLength(1)
    const surfaces = roomSurfaces(plan)
    const glass = rooms.rooms[0].glass
    const input = ircInput(rooms, 0, Float32Array.from([1, 1, 4, 2]), undefined, 'k')
    expect(input.rooms[0].target).toBeCloseTo(internalReflected(glass, surfaces), 9)
    expect(input.rooms[0].target).toBeCloseTo(roomIrc(rooms.rooms[0]), 9)
    expect(input.rooms[0].reflectance).toBeCloseTo(meanReflectance(surfaces), 9)
    expect(input.area).toBeCloseTo(2 * surfaces.floor + surfaces.walls, 6)
    expect([...input.calib.room]).toEqual([0, 0])
  })
})
