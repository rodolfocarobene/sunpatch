import { describe, expect, it } from 'vitest'
import { project } from './osm'
import { defaultPlan, rebasePlan } from './plan'

describe('rebasePlan', () => {
  const a = { lat: 45.4642, lon: 9.19 }
  const b = { lat: 45.4646, lon: 9.1905 }
  const square = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }]
  const plan = defaultPlan(
    { id: 'way/1', outer: square, holes: [], minHeight: 0, height: 9, heightSource: 'tag', tags: {} },
    a,
  )

  it('keeps every point at the same lat/lon', () => {
    const moved = rebasePlan(plan, b)
    const shift = project(a.lat, a.lon, b)
    expect(moved.origin).toEqual(b)
    expect(moved.outline.outer[1].x).toBeCloseTo(10 + shift.x, 3)
    expect(moved.outline.outer[1].z).toBeCloseTo(shift.z, 3)
  })

  it('moves the viewpoint and edits too', () => {
    const shift = project(a.lat, a.lon, b)
    const withExtras = {
      ...plan,
      viewpoint: { x: 1, z: 2, yaw: 0.5 },
      edits: [{ kind: 'add' as const, outline: square, bottom: 3, top: 3.2 }],
    }
    const moved = rebasePlan(withExtras, b)
    expect(moved.viewpoint!.x).toBeCloseTo(1 + shift.x, 3)
    expect(moved.viewpoint!.yaw).toBe(0.5)
    expect(moved.edits![0].outline[2].z).toBeCloseTo(10 + shift.z, 3)
    expect(moved.edits![0].top).toBe(3.2)
  })

  it('moves the panels too', () => {
    const shift = project(a.lat, a.lon, b)
    const withPanel = { ...plan, panels: [{ id: 'p', x: 3, z: 4, elevation: 1, width: 1.13, height: 1.72, tilt: 30, azimuth: 180 }] }
    const moved = rebasePlan(withPanel, b)
    expect(moved.panels[0].x).toBeCloseTo(3 + shift.x, 3)
    expect(moved.panels[0].z).toBeCloseTo(4 + shift.z, 3)
    expect(moved.panels[0].tilt).toBe(30)
  })

  it('returns the same plan for the same origin', () => {
    expect(rebasePlan(plan, { ...a })).toBe(plan)
  })
})
