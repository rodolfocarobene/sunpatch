import { describe, expect, it } from 'vitest'
import { BoxGeometry, Mesh } from 'three'
import type { Panel } from './plan'
import { panelMeshes } from './panel-mesh'
import { DAYS_IN_MONTH, panelNormal, panelSamples, SAMPLE_OFFSET, shadePanel, yearSlots } from './panel-shade'
import { buildBvh, collectOccluders } from './sunmap-trace'

const MILAN = { lat: 45.4642, lon: 9.19 }
const slots = yearSlots(MILAN.lat, MILAN.lon, 2025)
const FAR = Float32Array.from([1000, -50, 1000, 1001, -50, 1000, 1000, -50, 1001]) // nothing near the panel
const open = buildBvh(FAR)
const DEC = 11
const JUN = 5

const wall: Panel = { id: 'p', x: 0, z: 0, elevation: 2, width: 1.13, height: 1.72, tilt: 90, azimuth: 180 }

const boxAt = (x: number, y: number, z: number, w: number, h: number, d: number): Float32Array => {
  const mesh = new Mesh(new BoxGeometry(w, h, d))
  mesh.position.set(x, y, z)
  mesh.castShadow = true
  return collectOccluders([mesh])
}

describe('panelSamples', () => {
  it('puts 3 x 3 points per module on the front face, a little in front', () => {
    const p = { ...wall, count: 2 }
    const s = panelSamples(p)
    expect(s.length / 3).toBe(2 * 9)
    const n = panelNormal(p)
    // Every point is SAMPLE_OFFSET in front of the plane through the panel centre (0, y, 0) with normal n.
    for (let i = 0; i < s.length; i += 3) {
      expect(s[i] * n[0] + (s[i + 1] - 2.86) * n[1] + s[i + 2] * n[2]).toBeCloseTo(SAMPLE_OFFSET, 4)
    }
  })

  it('stays inside the panel in height and along the row', () => {
    const s = panelSamples(wall)
    const ys = Array.from({ length: s.length / 3 }, (_, i) => s[i * 3 + 1])
    expect(Math.min(...ys)).toBeGreaterThan(2)
    expect(Math.max(...ys)).toBeLessThan(2 + 1.72)
  })
})

describe('shadePanel', () => {
  it('has a 12 x 24 matrix and scales the twelve days by days per month', () => {
    const r = shadePanel(open, wall, slots)
    expect(r.lit).toHaveLength(12)
    expect(r.lit.every((row) => row.length === 24)).toBe(true)
    expect(r.front).toHaveLength(12)
    expect(r.up[0]).toHaveLength(24)
    const scaled = r.monthHours.reduce((sum, h, m) => sum + h * DAYS_IN_MONTH[m], 0)
    expect(r.annualHours).toBeCloseTo(scaled, 6)
    expect(DAYS_IN_MONTH.reduce((a, b) => a + b, 0)).toBe(365)
    for (const row of r.lit) for (const v of row) expect(v >= 0 && v <= 1).toBe(true)
  })

  it('counts every daylight hour on a flat panel with a clear sky', () => {
    const r = shadePanel(open, { ...wall, tilt: 0, elevation: 1 }, slots)
    expect(r.annualHours).toBeGreaterThan(4200)
    expect(r.annualHours).toBeLessThan(4600)
    expect(r.annualHours).toBeCloseTo(r.potentialHours, 6)
    expect(r.shadingLoss).toBe(0)
  })

  it('gives a south facing wall panel more winter sun, by energy, and about equal hours', () => {
    const r = shadePanel(open, wall, slots)
    // Hours alone barely differ: the sun is in front of a south wall about 8.5 h in December and 8.75 h in June
    // (the sun is above the horizon for 8.5 h and for 15.5 h). Weighted by incidence the winter sun is far stronger.
    expect(Math.abs(r.monthHours[DEC] - r.monthHours[JUN])).toBeLessThan(1)
    expect(r.monthCosHours[DEC]).toBeGreaterThan(r.monthCosHours[JUN] * 1.5)
    expect(r.shadingLoss).toBe(0)
    expect(r.annualHours).toBeCloseTo(r.potentialHours, 6)
  })

  it('gives a north facing wall panel no sun in December', () => {
    const r = shadePanel(open, { ...wall, azimuth: 0 }, slots)
    expect(r.monthHours[DEC]).toBe(0)
    expect(r.monthHours[JUN]).toBeGreaterThan(0)
  })

  it('loses energy to a box south of the panel', () => {
    // 6 m wide, 8 m tall box 3 m south of the wall panel.
    const wallBox = boxAt(0, 4, 4, 6, 8, 1)
    const r = shadePanel(buildBvh(wallBox), wall, slots)
    const clear = shadePanel(open, wall, slots)
    expect(r.shadingLoss).toBeGreaterThan(0.2)
    expect(r.annualHours).toBeLessThan(clear.annualHours)
    expect(r.potentialHours).toBeCloseTo(clear.potentialHours, 6)
    expect(r.annualCosHours).toBeLessThan(clear.annualCosHours)
    expect(r.potentialCosHours).toBeCloseTo(clear.potentialCosHours, 6)
  })

  it('does not shade a panel with its own mesh', () => {
    for (const tilt of [0, 30, 90]) {
      const own: Panel = { ...wall, tilt, elevation: 3, count: 3 }
      const withMesh = buildBvh(collectOccluders(panelMeshes([own])))
      const r = shadePanel(withMesh, own, slots)
      const clear = shadePanel(open, own, slots)
      expect(r.shadingLoss).toBe(0)
      expect(r.annualHours).toBeCloseTo(clear.annualHours, 6)
    }
  })

  it('lets a row shade the next one when they stand in each other\'s way', () => {
    const front: Panel = { ...wall, id: 'front', tilt: 30, elevation: 0.5, azimuth: 180, z: 0 }
    const behind: Panel = { ...front, id: 'behind', z: -1.2 }
    const scene = buildBvh(collectOccluders(panelMeshes([front, behind])))
    const r = shadePanel(scene, behind, slots)
    expect(r.shadingLoss).toBeGreaterThan(0.05)
    expect(shadePanel(scene, front, slots).shadingLoss).toBeLessThan(r.shadingLoss)
  })
})
