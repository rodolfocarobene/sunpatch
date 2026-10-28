import { describe, expect, it } from 'vitest'
import { buildingGeometry } from './footprint'
import type { Building } from './osm'

// Non-symmetric footprint: a tall strip reaching 10 m north (z = -10) and a short arm 6 m east.
const outer = [
  { x: 0, z: 0 },
  { x: 6, z: 0 },
  { x: 6, z: -3 },
  { x: 2, z: -3 },
  { x: 2, z: -10 },
  { x: 0, z: -10 },
]
const building: Building = {
  id: 'way/1', outer, holes: [], minHeight: 3, height: 12, heightSource: 'tag', tags: {},
}

describe('buildingGeometry', () => {
  const g = buildingGeometry(building)
  g.computeBoundingBox()
  const box = g.boundingBox!

  it('keeps east = +x and north = -z (not mirrored)', () => {
    expect(box.min.x).toBeCloseTo(0)
    expect(box.max.x).toBeCloseTo(6)
    expect(box.min.z).toBeCloseTo(-10)
    expect(box.max.z).toBeCloseTo(0)
    // the arm (x up to 6) sits at the southern end (z near 0)
    const pos = g.getAttribute('position')
    for (let i = 0; i < pos.count; i++) {
      if (pos.getX(i) > 2) expect(pos.getZ(i)).toBeGreaterThanOrEqual(-3 - 1e-6)
    }
  })

  it('spans minHeight to height along +y', () => {
    expect(box.min.y).toBeCloseTo(3)
    expect(box.max.y).toBeCloseTo(12)
  })

  it('has an upward-facing roof', () => {
    const n = g.getAttribute('normal')
    const pos = g.getAttribute('position')
    let roofVertices = 0
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getY(i) - 12) < 1e-6 && n.getY(i) > 0.99) roofVertices++
    }
    expect(roofVertices).toBeGreaterThan(0)
  })
})
