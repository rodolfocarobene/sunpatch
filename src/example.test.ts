import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/overpass-milan-duomo.json'
import { buildExample } from './example'
import { validatePlan } from './editor-geom'
import type { OverpassElement } from './osm'

describe('buildExample', () => {
  const example = buildExample(fixture.elements as unknown as OverpassElement[])

  it('selects Palazzo Reale', () => {
    expect(example.selected.id.startsWith('relation/36488')).toBe(true)
  })

  it('makes a valid floor-1 plan of about 12 x 10 m with 3 windows and a wall', () => {
    const { plan } = example
    expect('plan' in validatePlan(plan)).toBe(true)
    expect(plan.buildingId).toBe(example.selected.id)
    expect(plan.floor).toBe(1)
    expect(plan.windows).toHaveLength(3)
    expect(plan.walls).toHaveLength(1)
    const [p0, p1, , p3] = plan.outline.outer
    expect(Math.hypot(p1.x - p0.x, p1.z - p0.z)).toBeCloseTo(12, 5)
    expect(Math.hypot(p3.x - p0.x, p3.z - p0.z)).toBeCloseTo(10, 5)
  })
})
