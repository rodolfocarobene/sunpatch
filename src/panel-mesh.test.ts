import { describe, expect, it } from 'vitest'
import { Vector3, type Mesh } from 'three'
import { basisHandedness, panelMeshes } from './panel-mesh'
import { panelCorners } from './panel'
import type { Panel } from './plan'
import { collectOccluders } from './sunmap-trace'

const panel: Panel = { id: 'a', x: 2, z: -3, elevation: 4, width: 1.13, height: 1.72, tilt: 30, azimuth: 200, count: 2 }

describe('panelMeshes', () => {
  it('makes one shadow casting box per module, plus edge lines', () => {
    const out = panelMeshes([panel])
    const boxes = out.filter((o): o is Mesh => (o as Mesh).isMesh)
    expect(boxes).toHaveLength(2)
    expect(out).toHaveLength(4)
    for (const b of boxes) {
      expect(b.castShadow).toBe(true)
      expect(b.receiveShadow).toBe(true)
    }
    expect(collectOccluders(out).length).toBe(2 * 12 * 3 * 3)
  })

  it('puts the outer corners of the row where panelCorners says', () => {
    const [first, , second] = panelMeshes([panel]) as Mesh[]
    const corners = panelCorners(panel)
    const at = (m: Mesh, x: number, z: number) => new Vector3(x, 0, z).applyMatrix4(m.matrix)
    const { width: w, height: h } = panel
    const check = (v: Vector3, c: { x: number; y: number; z: number }) => {
      expect(v.x).toBeCloseTo(c.x)
      expect(v.y).toBeCloseTo(c.y)
      expect(v.z).toBeCloseTo(c.z)
    }
    check(at(first, -w / 2, -h / 2), corners[0])
    check(at(first, -w / 2, h / 2), corners[3])
    check(at(second, w / 2, -h / 2), corners[1])
    check(at(second, w / 2, h / 2), corners[2])
  })

  it('never mirrors the boxes', () => {
    for (const [az, tilt] of [[0, 90], [90, 30], [180, 0], [270, 45]]) expect(basisHandedness(az, tilt)).toBeGreaterThan(0)
  })
})
