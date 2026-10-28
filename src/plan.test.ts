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

  it('returns the same plan for the same origin', () => {
    expect(rebasePlan(plan, { ...a })).toBe(plan)
  })
})
