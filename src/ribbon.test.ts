import { describe, expect, it } from 'vitest'
import { ribbonData, ribbonsData } from './ribbon'

const square = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }]

describe('ribbonData', () => {
  it('has two vertices per ring point and two triangles per edge', () => {
    const r = ribbonData(square, 3, 0.2)
    expect(r.positions.length / 3).toBe(8)
    expect(r.indices.length).toBe(4 * 6)
  })

  it('stays at the given height', () => {
    const r = ribbonData(square, 3, 0.2)
    for (let i = 1; i < r.positions.length; i += 3) expect(r.positions[i]).toBe(3)
  })

  it('puts the corner vertices a mitre away from the ring point, on both sides', () => {
    const r = ribbonData(square, 0, 0.2)
    const reach = Math.hypot(0.1, 0.1)
    const [ax, , az, bx, , bz] = r.positions
    expect(Math.hypot(ax - 0, az - 0)).toBeCloseTo(reach)
    expect(Math.hypot(bx - 0, bz - 0)).toBeCloseTo(reach)
    // opposite sides of the corner
    expect(ax + bx).toBeCloseTo(0)
    expect(az + bz).toBeCloseTo(0)
  })

  it('caps the mitre at a hairpin corner', () => {
    const spike = [{ x: 0, z: 0 }, { x: 10, z: 0.01 }, { x: 0, z: 0.02 }]
    const r = ribbonData(spike, 0, 0.2)
    for (let i = 0; i < r.positions.length; i += 3) {
      const near = [0, 1, 2].some((k) => Math.hypot(r.positions[i] - spike[k].x, r.positions[i + 2] - spike[k].z) <= 0.2 + 1e-9)
      expect(near).toBe(true)
    }
  })
})

describe('ribbonsData', () => {
  it('merges rings and offsets their indices', () => {
    const r = ribbonsData([square, square], 0, 0.2)
    expect(r.positions.length / 3).toBe(16)
    expect(Math.max(...r.indices)).toBe(15)
    expect(Math.min(...r.indices.slice(24))).toBeGreaterThanOrEqual(8)
  })

  it('skips degenerate rings', () => {
    expect(ribbonsData([[{ x: 0, z: 0 }]], 0, 0.2).indices).toEqual([])
  })
})
