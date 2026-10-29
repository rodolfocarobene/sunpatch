import { describe, expect, it } from 'vitest'
import { defaultPlan } from './plan'
import type { Panel } from './plan'
import { azimuthOf, edgeOutward, exteriorEdge, FACADE_GAP, hitsPanel, newPanel, panelCorners, panelFootprint, panelTip, presetPatch, snapPanel } from './panel'

const base: Panel = { id: 'a', x: 0, z: 0, elevation: 1, width: 1, height: 2, tilt: 90, azimuth: 0 }
const square = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }]
const building = { id: 'way/1', outer: square, holes: [], minHeight: 0, height: 9, levels: 3, heightSource: 'tag' as const, tags: {} }
const plan = defaultPlan(building, { lat: 45, lon: 9 }, 1)

describe('panelCorners', () => {
  it('stands a vertical panel on its centre, facing east', () => {
    const c = panelCorners({ ...base, azimuth: 90 })
    for (const p of c) expect(p.x).toBeCloseTo(0)
    expect(c.map((p) => p.y)).toEqual([1, 1, 3, 3])
    expect(c.map((p) => p.z)).toEqual([-0.5, 0.5, 0.5, -0.5].map((z) => expect.closeTo(z)))
  })

  it('leans a south facing 30 degree panel back towards the north', () => {
    const c = panelCorners({ ...base, tilt: 30, azimuth: 180 })
    const reach = Math.cos(Math.PI / 6)
    expect(c[0].z).toBeCloseTo(reach)
    expect(c[0].y).toBeCloseTo(1)
    expect(c[2].z).toBeCloseTo(-reach)
    expect(c[2].y).toBeCloseTo(2)
    expect(c[1].x).toBeCloseTo(-0.5)
  })

  it('lies a flat panel at one height and spans a row of modules', () => {
    const c = panelCorners({ ...base, tilt: 0, count: 3 })
    expect(new Set(c.map((p) => p.y))).toEqual(new Set([1]))
    expect(Math.hypot(c[1].x - c[0].x, c[1].z - c[0].z)).toBeCloseTo(3)
  })
})

describe('plan footprint and handle', () => {
  it('gives a vertical panel a minimum depth', () => {
    const ring = panelFootprint(base, 0.1)
    expect(Math.abs(ring[0].z - ring[3].z)).toBeCloseTo(0.1)
  })

  it('puts the rotate handle in front of the panel', () => {
    const tip = panelTip({ ...base, azimuth: 90 })
    expect(tip.x).toBeCloseTo(1)
    expect(tip.z).toBeCloseTo(0)
  })

  it('hits inside and near the footprint', () => {
    const p = { ...base, tilt: 30, azimuth: 180 }
    expect(hitsPanel(p, { x: 0, z: 0.5 }, 0.1)).toBe(true)
    expect(hitsPanel(p, { x: 3, z: 0 }, 0.1)).toBe(false)
  })

  it('converts directions to azimuths', () => {
    expect(azimuthOf(0, -1)).toBeCloseTo(0)
    expect(azimuthOf(1, 0)).toBeCloseTo(90)
    expect(azimuthOf(0, 1)).toBeCloseTo(180)
    expect(azimuthOf(-1, 0)).toBeCloseTo(270)
  })
})

describe('snapPanel', () => {
  it('snaps to the near edge, a little outside, facing out', () => {
    const s = snapPanel({ x: 5, z: 0.4 }, [square], [], 1)!
    expect(s.point.x).toBeCloseTo(5)
    expect(s.point.z).toBeCloseTo(-FACADE_GAP)
    expect(s.azimuth).toBeCloseTo(0)
    expect(snapPanel({ x: 10.3, z: 4 }, [square], [], 1)!.azimuth).toBeCloseTo(90)
  })

  it('faces into a hole', () => {
    const hole = [{ x: 4, z: 4 }, { x: 6, z: 4 }, { x: 6, z: 6 }, { x: 4, z: 6 }]
    expect(snapPanel({ x: 5, z: 4.1 }, [], [hole], 1)!.azimuth).toBeCloseTo(180)
    expect(edgeOutward(hole, 0, true).z).toBeCloseTo(1)
  })

  it('ignores apartment edges inside the building but keeps those on its exterior', () => {
    const inner = [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 5 }, { x: 0, z: 5 }]
    const accept = exteriorEdge(building)
    // The click is nearest the buried edge x = 5; the footprint's own edge x = 0 is the only exterior one near.
    expect(snapPanel({ x: 5.2, z: 3 }, [square, inner], [], 1, accept)).toBeUndefined()
    expect(snapPanel({ x: 5.2, z: 3 }, [square, inner], [], 1)!.point.x).toBeCloseTo(5 + FACADE_GAP)
    const s = snapPanel({ x: 3, z: 0.2 }, [square, inner], [], 1, accept)!
    expect(s.point.z).toBeCloseTo(-FACADE_GAP)
    expect(s.azimuth).toBeCloseTo(0)
    // An edge on the footprint's courtyard counts as exterior.
    const court = { ...building, holes: [[{ x: 4, z: 4 }, { x: 6, z: 4 }, { x: 6, z: 6 }, { x: 4, z: 6 }]] }
    expect(snapPanel({ x: 5, z: 4.1 }, [], [court.holes[0]], 1, exteriorEdge(court))!.azimuth).toBeCloseTo(180)
  })

  it('does not snap beyond the tolerance', () => {
    expect(snapPanel({ x: 5, z: 3 }, [square], [], 1)).toBeUndefined()
  })
})

describe('new panels and presets', () => {
  it('defaults to a vertical facade panel at railing height when snapped', () => {
    const snap = snapPanel({ x: 5, z: 0.2 }, [square], [], 1)!
    const p = newPanel({ x: 5, z: 0.2 }, building, plan, snap)
    expect(p).toMatchObject({ tilt: 90, azimuth: 0, elevation: 4, width: 1.13, height: 1.72 })
  })

  it('defaults to a south facing stand elsewhere', () => {
    expect(newPanel({ x: 12, z: 3 }, building, plan)).toMatchObject({ x: 12, z: 3, tilt: 30, azimuth: 180 })
  })

  it('presets set tilt and elevation', () => {
    expect(presetPatch('railing', building, plan)).toEqual({ tilt: 90, elevation: 4 })
    expect(presetPatch('roof', building, plan)).toEqual({ tilt: 30, elevation: 9 })
    expect(presetPatch('ground', building, plan)).toEqual({ tilt: 30, elevation: 0.5 })
  })
})
