import { describe, expect, it } from 'vitest'
import { apartmentGeometry, piecesOf } from './apartment'
import { selectBuilding } from './block'
import { parseOverpass, type Building, type OverpassElement } from './osm'
import { SLAB_THICKNESS, defaultPlan } from './plan'
import a from '../fixtures/overpass-stacked-a.json'
import b from '../fixtures/overpass-stacked-b.json'
import c from '../fixtures/overpass-stacked-c.json'
import c2 from '../fixtures/overpass-stacked-c2.json'
import d from '../fixtures/overpass-stacked-d.json'

// Synthetic Overpass answers for the stacked and overlapping shapes OSM uses (see fixtures/overpass-stacked-*.json).
const ORIGIN = { lat: 45.4642, lon: 9.19 }
const FLOOR = 1
const CASES: { name: string; json: { elements: unknown[] }; click: { x: number; z: number }; ids: string[] }[] = [
  { name: 'two outlines on one footprint, 9 m and 21 m', json: a, click: { x: 0, z: 0 }, ids: ['way/100', 'way/101'] },
  { name: 'an outline with parts 0-12 m and 12-24 m', json: b, click: { x: 0, z: 0 }, ids: ['way/102', 'way/103', 'way/104'] },
  { name: 'a tower part inside a podium outline', json: c, click: { x: -9, z: 0 }, ids: ['way/105', 'way/106'] },
  { name: 'a tower building inside a podium building', json: c2, click: { x: -9, z: 0 }, ids: ['way/107', 'way/108'] },
  { name: 'a part sticking out of its outline over a neighbour', json: d, click: { x: -8, z: 0 }, ids: ['way/109', 'way/110', 'way/111'] },
]

const box = (g: { computeBoundingBox(): void; boundingBox: any }) => {
  g.computeBoundingBox()
  return g.boundingBox
}

function load(json: { elements: unknown[] }, click: { x: number; z: number }) {
  const all = parseOverpass(json.elements as OverpassElement[], ORIGIN).buildings
  return { all, selected: selectBuilding(all, click)! }
}

describe.each(CASES)('stacked buildings: $name', ({ json, click, ids }) => {
  const { all, selected } = load(json, click)
  const plan = defaultPlan(selected, ORIGIN, FLOOR)
  const g = apartmentGeometry(selected, plan)
  const ceilingBottom = plan.floor * plan.floorHeight + plan.floorHeight - SLAB_THICKNESS

  it('selects every polygon that is stacked or overlapping', () => {
    expect(all.map((x) => x.id).sort()).toEqual([...ids].sort())
    expect([...(selected.sources ?? [selected.id])].sort()).toEqual([...ids].sort())
  })

  it('cuts every drawn member around the apartment: nothing of the shell passes the ceiling slab', () => {
    expect(g.shell.length).toBeGreaterThan(0)
    for (const s of g.shell) expect(box(s).max.y).toBeLessThanOrEqual(ceilingBottom + 1e-6)
  })

  it('sends everything above the apartment ceiling to the cutaway group', () => {
    for (const geometry of g.ceiling) expect(box(geometry).min.y).toBeGreaterThanOrEqual(ceilingBottom - 1e-6)
    for (const m of piecesOf(selected).filter((x) => x.height > ceilingBottom + 0.01)) {
      expect(g.ceiling.some((geometry) => Math.abs(box(geometry).max.y - m.height) < 1e-6)).toBe(true)
    }
    // the tallest roof is in the cutaway group, so no tower is left standing over the open apartment
    const roof = Math.max(...piecesOf(selected).map((x) => x.height))
    expect(Math.max(...[...g.shell, ...g.ceiling].map((s) => box(s).max.y))).toBeCloseTo(roof)
    expect(Math.max(...g.shell.map((s) => box(s).max.y))).toBeLessThanOrEqual(ceilingBottom + 1e-6)
  })

  it('draws no volume twice (no coincident shells to z-fight)', () => {
    const drawn = [...g.shell, ...g.ceiling].map((s) => box(s))
    for (let i = 0; i < drawn.length; i++) {
      for (let j = i + 1; j < drawn.length; j++) {
        const p = drawn[i]
        const q = drawn[j]
        const same =
          ['x', 'y', 'z'].every((k) => Math.abs(p.min[k] - q.min[k]) < 0.25 && Math.abs(p.max[k] - q.max[k]) < 0.25)
        expect(same, `pieces ${i} and ${j} coincide`).toBe(false)
      }
    }
  })

  it('draws only pieces that are not hidden under another', () => {
    const members = piecesOf(selected)
    for (const m of members) {
      const covered = members.some(
        (o) =>
          o !== m && o.minHeight <= m.minHeight && o.height >= m.height && sameFootprint(o, m),
      )
      expect(covered, `${m.id} lies inside ${members.map((o) => o.id).join(',')}`).toBe(false)
    }
  })
})

function sameFootprint(o: Building, m: Building): boolean {
  const bb = (r: Building) => {
    const xs = r.outer.map((p) => p.x)
    const zs = r.outer.map((p) => p.z)
    return [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)]
  }
  const [a0, a1, b0, b1] = bb(o)
  const [c0, c1, d0, d1] = bb(m)
  return c0 >= a0 - 0.3 && c1 <= a1 + 0.3 && d0 >= b0 - 0.3 && d1 <= b1 + 0.3
}

describe('which polygons are drawn of a stacked selection', () => {
  const members = (json: { elements: unknown[] }, click: { x: number; z: number }) =>
    (load(json, click).selected.members ?? []).map((m) => `${m.id}:${m.minHeight}-${m.height}`)

  it('draws the taller of two outlines on one footprint, not both', () => {
    expect(members(a, { x: 0, z: 0 })).toEqual(['way/101:0-21'])
  })

  it('draws the parts and not the outline they cover', () => {
    expect(members(b, { x: 0, z: 0 })).toEqual(['way/103:0-12', 'way/104:12-24'])
  })

  it('keeps a podium outline that its tower part covers only in part', () => {
    expect(members(c, { x: -9, z: 0 }).sort()).toEqual(['way/105:0-9', 'way/106:0-30'])
  })

  it('keeps the part of an outline that a part leaves bare, and a neighbour the part overlaps', () => {
    expect(members(d, { x: -8, z: 0 }).sort()).toEqual(['way/109:0-15', 'way/110:0-24', 'way/111:0-12'])
  })
})
