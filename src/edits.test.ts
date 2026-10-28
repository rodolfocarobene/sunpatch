import { describe, expect, it } from 'vitest'
import { addsOf, carve, cutsOf, sparing, toPairs } from './edits'
import { ringArea } from './osm'
import type { Point } from './osm'
import type { BuildingEdit } from './plan'

const rect = (x0: number, z0: number, x1: number, z1: number): Point[] => [
  { x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 },
]
const block = rect(0, 0, 10, 10)
const cut = (outline: Point[], bottom: number, top: number): BuildingEdit => ({ kind: 'cut', outline, bottom, top })
const area = (p: { outer: Point[]; holes: Point[][] }) => ringArea(p.outer) - p.holes.reduce((s, h) => s + ringArea(h), 0)

describe('carve', () => {
  it('returns the block untouched without cuts', () => {
    const pieces = carve(block, [], 0, 9, [])
    expect(pieces).toEqual([{ outer: block, holes: [], bottom: 0, top: 9 }])
  })

  it('splits the height range at the cut: 3 pieces, the middle one with a hole', () => {
    const pieces = carve(block, [], 0, 9, cutsOf([cut(rect(4, 4, 6, 6), 3, 6)]))
    expect(pieces.map((p) => [p.bottom, p.top])).toEqual([[0, 3], [3, 6], [6, 9]])
    expect(area(pieces[0])).toBeCloseTo(100)
    expect(pieces[1].holes).toHaveLength(1)
    expect(area(pieces[1])).toBeCloseTo(96)
    expect(area(pieces[2])).toBeCloseTo(100)
  })

  it('notches the middle piece when the cut touches the edge', () => {
    const [, middle] = carve(block, [], 0, 9, cutsOf([cut(rect(8, -2, 12, 4), 3, 6)]))
    expect(middle.holes).toHaveLength(0)
    expect(area(middle)).toBeCloseTo(100 - 2 * 4)
  })

  it('unions overlapping cuts over their shared heights', () => {
    const cuts = cutsOf([cut(rect(0, 0, 4, 10), 0, 6), cut(rect(2, 0, 6, 10), 3, 9)])
    const pieces = carve(block, [], 0, 9, cuts)
    expect(pieces.map((p) => [p.bottom, p.top, Math.round(area(p))])).toEqual([[0, 3, 60], [3, 6, 40], [6, 9, 20], [6, 9, 40]])
  })

  it('drops pieces that are cut away entirely and ignores cuts outside the range', () => {
    const pieces = carve(block, [], 0, 9, cutsOf([cut(rect(-1, -1, 11, 11), 3, 6), cut(rect(4, 4, 6, 6), 20, 30)]))
    expect(pieces.map((p) => [p.bottom, p.top])).toEqual([[0, 3], [6, 9]])
  })
})

describe('sparing', () => {
  it('removes the apartment footprint from cuts that reach its storey only', () => {
    const apartment = [toPairs(rect(0, 0, 10, 5))]
    const [through, above] = sparing(cutsOf([cut(rect(0, 0, 10, 10), 2, 5), cut(rect(0, 0, 10, 10), 6, 9)]), apartment, 3, 6)
    const [lowerPiece] = carve(block, [], 0, 3, [through])
    expect(area(lowerPiece)).toBeCloseTo(100)
    const middle = carve(block, [], 2, 3, [through])
    expect(area(middle[0])).toBeCloseTo(50)
    expect(carve(block, [], 6, 9, [above])).toHaveLength(0)
  })
})

describe('addsOf', () => {
  it('keeps only valid add edits', () => {
    const add: BuildingEdit = { kind: 'add', outline: rect(0, 0, 1, 1), bottom: 0, top: 1 }
    expect(addsOf([add, cut(rect(0, 0, 1, 1), 0, 1), { ...add, top: 0 }, { ...add, outline: [] }])).toEqual([add])
    expect(addsOf(undefined)).toEqual([])
  })
})
