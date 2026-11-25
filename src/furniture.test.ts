import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadSavedPlan, savePlan } from './editor'
import { validatePlan } from './editor-geom'
import {
  FURNITURE, checkFurniture, furnitureFootprint, furnitureName, furnitureTip, hasPot, hitsFurniture, potAt, newFurniture, packFurniture, rotationToward, snapMetres, specOf, unpackFurniture,
  type Furniture,
} from './furniture'
import { useLang } from './i18n'
import { en, it as italian } from './i18n/index'
import { project } from './osm'
import { rebasePlan, type Plan } from './plan'

const sq = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }]
const plan: Plan = {
  version: 1,
  buildingId: 'way/1',
  origin: { lat: 45, lon: 9 },
  floor: 1,
  floorHeight: 3,
  outline: { outer: sq, holes: [] },
  walls: [],
  windows: [],
  panels: [],
}
const pieces: Furniture[] = [
  { kind: 'bed2', x: 2.5, z: 3.05, rot: 90 },
  { kind: 'sofa', x: 6, z: 7.2, rot: 15 },
  { kind: 'plant', x: -0.4, z: 9.95, rot: 0 },
]

afterEach(() => {
  useLang('en')
  vi.unstubAllGlobals()
})

describe('catalogue', () => {
  it('has the sizes asked for, unique kinds and codes', () => {
    const size = (kind: Parameters<typeof specOf>[0]) => [specOf(kind).w, specOf(kind).d]
    expect(size('bed2')).toEqual([1.6, 2])
    expect(size('bed1')).toEqual([0.9, 2])
    expect(size('sofa')).toEqual([2, 0.9])
    expect(size('table')).toEqual([1.6, 0.9])
    expect(size('desk')).toEqual([1.2, 0.6])
    expect([...size('wardrobe'), specOf('wardrobe').h]).toEqual([1.2, 0.6, 2])
    expect([...size('shelf'), specOf('shelf').h]).toEqual([0.8, 0.3, 1.8])
    expect([...size('counter'), specOf('counter').h]).toEqual([2.4, 0.6, 0.9])
    expect(size('rug')).toEqual([2, 1.4])
    expect(new Set(FURNITURE.map((s) => s.kind)).size).toBe(FURNITURE.length)
    expect(new Set(FURNITURE.map((s) => s.code)).size).toBe(FURNITURE.length)
  })

  it('names every kind in both languages', () => {
    for (const s of FURNITURE) {
      expect(en[s.name]).toBeTruthy()
      expect(italian[s.name]).toBeTruthy()
    }
    expect(italian['editor.furnBed2']).toBe('Letto matrimoniale')
    expect(italian['editor.furnCounter']).toBe('Piano cucina')
  })
})

describe('footprint and hits', () => {
  it('turns clockwise in the plan and puts the front toward +z at rot 0', () => {
    const f = newFurniture('sofa', { x: 5, z: 5 })
    expect(furnitureTip(f).z).toBeCloseTo(5 + 0.45 + 0.5)
    const turned = furnitureFootprint({ ...f, rot: 90 }) // width 2 (x) now runs along z
    expect(Math.max(...turned.map((p) => p.x)) - Math.min(...turned.map((p) => p.x))).toBeCloseTo(0.9)
    expect(Math.max(...turned.map((p) => p.z)) - Math.min(...turned.map((p) => p.z))).toBeCloseTo(2)
    expect(furnitureTip({ ...f, rot: 90 }).x).toBeCloseTo(5 - 0.95) // front now faces west
  })

  it('hits inside and near the edge only, also when turned', () => {
    const f: Furniture = { kind: 'sofa', x: 5, z: 5, rot: 90 }
    expect(hitsFurniture(f, { x: 5, z: 5.9 }, 0)).toBe(true)
    expect(hitsFurniture(f, { x: 5.6, z: 5 }, 0)).toBe(false)
    expect(hitsFurniture(f, { x: 5.7, z: 5 }, 0.2)).toBe(false)
    expect(hitsFurniture(f, { x: 5.6, z: 5 }, 0.2)).toBe(true)
  })

  it('reads a drag of the handle back as the rotation', () => {
    const f = newFurniture('chair', { x: 1, z: 1 })
    for (const rot of [0, 45, 90, 180, 270]) {
      expect(rotationToward(f, furnitureTip({ ...f, rot }))).toBeCloseTo(rot)
    }
    expect(rotationToward(f, { x: 1, z: 3 }, 15)).toBe(0)
    expect(rotationToward(f, { x: 0.5, z: 2.9 }, 15)).toBe(15)
    expect(snapMetres(1.37)).toBe(1.35)
  })
})

describe('plan data', () => {
  it('survives JSON export and import', () => {
    const withFurniture: Plan = { ...plan, furniture: pieces }
    expect(validatePlan(JSON.parse(JSON.stringify(withFurniture)))).toEqual({ plan: withFurniture })
  })

  it('loads an old plan without the field unchanged', () => {
    const result = validatePlan(JSON.parse(JSON.stringify(plan)))
    expect(result).toEqual({ plan })
    expect('plan' in result && 'furniture' in result.plan).toBe(false)
  })

  it('rejects malformed furniture and drops unknown kinds', () => {
    for (const bad of ['sofa', [null], [{ kind: 'sofa', x: 1, z: NaN, rot: 0 }], [{ kind: 'sofa', x: 1, z: 2 }]]) {
      expect(validatePlan({ ...plan, furniture: bad })).toHaveProperty('error')
    }
    expect(checkFurniture([{ kind: 'piano', x: 1, z: 2, rot: 0 }, pieces[0]])).toEqual({ furniture: [pieces[0]] })
  })

  it('is saved and loaded from localStorage with the plan', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    })
    savePlan({ ...plan, furniture: pieces })
    expect(loadSavedPlan('way/1')?.furniture).toEqual(pieces)
    savePlan(plan)
    expect(loadSavedPlan('way/1')).toEqual(plan)
  })

  it('moves with the plan when it is rebased', () => {
    const b = { lat: 45.0004, lon: 9.0005 }
    const shift = project(45, 9, b)
    const moved = rebasePlan({ ...plan, furniture: pieces }, b)
    expect(moved.furniture![1].x).toBeCloseTo(6 + shift.x, 3)
    expect(moved.furniture![1].z).toBeCloseTo(7.2 + shift.z, 3)
    expect(moved.furniture![1].rot).toBe(15)
  })
})

describe('packed form (share links)', () => {
  it('keeps 5 cm and 5 degrees and is lossless for what the editor makes', () => {
    expect(unpackFurniture(packFurniture(pieces))).toEqual(pieces)
    const loose = [{ kind: 'desk' as const, x: 1.234, z: -2.468, rot: 358 }]
    expect(unpackFurniture(packFurniture(loose))).toEqual([{ kind: 'desk', x: 1.25, z: -2.45, rot: 0 }])
  })

  it('is compact, and skips what it does not understand', () => {
    expect(packFurniture([pieces[0]])).toEqual([['bd', 50, 61, 18]])
    expect(unpackFurniture([['zz', 1, 2, 3], ['sf', 'a', 2, 3], 'x', ['sf', 20, 40, 0]])).toEqual([{ kind: 'sofa', x: 1, z: 2, rot: 0 }])
    expect(unpackFurniture('nope')).toEqual([])
  })

  it('adds a pot'+"'"+'s plant id, and its height in decimetres only when it is off the apartment floor', () => {
    const floor: Furniture = { kind: 'plant', x: 1, z: 2, rot: 0, plant: 'basil' }
    const roof: Furniture = { kind: 'plant', x: 1.5, z: -2, rot: 0, plant: 'tomato', y: 12.3 }
    expect(packFurniture([floor, roof])).toEqual([['pl', 20, 40, 0, 'basil'], ['pl', 30, -40, 0, 'tomato', 123]])
    expect(unpackFurniture(packFurniture([floor, roof, pieces[1]]))).toEqual([floor, roof, pieces[1]])
    // an old link (four numbers) still opens, bad extras are ignored
    expect(unpackFurniture([['pl', 20, 40, 0]])).toEqual([{ kind: 'plant', x: 1, z: 2, rot: 0 }])
    expect(unpackFurniture([['pl', 20, 40, 0, 'Not An Id!', 'x']])).toEqual([{ kind: 'plant', x: 1, z: 2, rot: 0 }])
    expect(unpackFurniture([['pl', 20, 40, 0, '', 5]])).toEqual([{ kind: 'plant', x: 1, z: 2, rot: 0, y: 0.5 }])
  })

  it('adds a window box'+"'"+'s own width in 5 cm units, after its plant and height', () => {
    const box: Furniture = { kind: 'windowbox', x: 5, z: -0.15, rot: 180, plant: 'geranium', y: 3.6, w: 1.2 }
    const wall: Furniture = { kind: 'wallpot', x: 1, z: 0.45, rot: 0, plant: 'pothos', y: 4.5 }
    expect(packFurniture([box, wall])).toEqual([['wb', 100, -3, 36, 'geranium', 36, 24], ['wp', 20, 9, 0, 'pothos', 45]])
    expect(unpackFurniture(packFurniture([box, wall]))).toEqual([box, wall])
    expect(packFurniture([{ kind: 'shelf', x: 0, z: 0, rot: 0, w: 1 }])).toEqual([['bk', 0, 0, 0, '', '', 20]])
    expect(unpackFurniture([['bk', 0, 0, 0, '', '', 20]])).toEqual([{ kind: 'shelf', x: 0, z: 0, rot: 0, w: 1 }])
    expect(unpackFurniture([['wb', 0, 0, 0, 'basil', 30, -4]])).toEqual([{ kind: 'windowbox', x: 0, z: 0, rot: 0, plant: 'basil', y: 3 }])
  })
})

describe('pots', () => {
  it('put a plant at a picked spot: snapped, with a height only off the apartment floor', () => {
    expect(potAt('basil', { x: 1.234, y: 3.02, z: -2.46 }, true)).toEqual({ kind: 'plant', x: 1.25, z: -2.45, rot: 0, plant: 'basil' })
    expect(potAt('basil', { x: 1, y: 12.34, z: 2 }, false)).toEqual({ kind: 'plant', x: 1, z: 2, rot: 0, plant: 'basil', y: 12.3 })
  })

  it('are not stacked: the same plant at the same spot is already there', () => {
    const pot = potAt('basil', { x: 1, y: 0, z: 2 }, false)
    expect(hasPot(undefined, pot)).toBe(false)
    expect(hasPot([pot], potAt('basil', { x: 1.02, y: 0.04, z: 2 }, false))).toBe(true)
    expect(hasPot([pot], potAt('mint', { x: 1, y: 0, z: 2 }, false))).toBe(false)
    expect(hasPot([pot], potAt('basil', { x: 1.5, y: 0, z: 2 }, false))).toBe(false)
    expect(hasPot([pot], potAt('basil', { x: 1, y: 3, z: 2 }, false))).toBe(false)
  })

  it('keep the plant and height through validation, and take the plant'+"'"+'s name in the current language', () => {
    const pot: Furniture = { kind: 'plant', x: 1, z: 2, rot: 0, plant: 'tomato', y: 6.5 }
    expect(checkFurniture(JSON.parse(JSON.stringify([pot])))).toEqual({ furniture: [pot] })
    expect(checkFurniture([{ ...pot, plant: 7, y: 'high' }])).toEqual({ furniture: [{ kind: 'plant', x: 1, z: 2, rot: 0 }] })
    expect(furnitureName(pot)).toBe('tomato')
    useLang('it')
    expect(furnitureName(pot)).toBe('pomodoro')
    expect(furnitureName({ ...pot, plant: 'no-such-plant' })).toBe(italian['editor.furnPlant'])
    expect(furnitureName({ ...pot, kind: 'windowbox' })).toBe('Fioriera da davanzale con pomodoro')
    useLang('en')
    expect(furnitureName({ ...pot, kind: 'wallpot', plant: 'pothos' })).toBe('Wall planter with pothos')
  })

  it('keep a window box'+"'"+'s width through validation, and size it by that width', () => {
    const box: Furniture = { kind: 'windowbox', x: 0, z: 0, rot: 0, plant: 'basil', y: 3, w: 1.4 }
    expect(checkFurniture(JSON.parse(JSON.stringify([box])))).toEqual({ furniture: [box] })
    expect(checkFurniture([{ ...box, w: -1 }])).toEqual({ furniture: [{ kind: 'windowbox', x: 0, z: 0, rot: 0, plant: 'basil', y: 3 }] })
    const xs = furnitureFootprint(box).map((p) => p.x)
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1.4)
    expect(hitsFurniture(box, { x: 0.65, z: 0 }, 0)).toBe(true)
    expect(hitsFurniture({ ...box, w: undefined }, { x: 0.65, z: 0 }, 0)).toBe(false)
  })

  it('keep their height when the plan is rebased (only x and z move)', () => {
    const pot: Furniture = { kind: 'plant', x: 1, z: 2, rot: 0, plant: 'tomato', y: 6.5 }
    const moved = rebasePlan({ ...plan, furniture: [pot] }, { lat: 45.0004, lon: 9.0005 })
    expect(moved.furniture![0]).toMatchObject({ plant: 'tomato', y: 6.5 })
    expect(moved.furniture![0].x).not.toBe(1)
  })
})
