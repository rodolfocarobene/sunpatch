import { Box3, BoxGeometry, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { FURNITURE, furnitureFootprint, type Furniture } from './furniture'
import { furnitureMesh } from './furniture-mesh'
import { collectOccluders, occluderRoots, sceneKey } from './sunmap-trace'

const at = (kind: Furniture['kind'], rot = 0): Furniture => ({ kind, x: 0, z: 0, rot })

describe('furnitureMesh', () => {
  it('builds every kind within its footprint and height, standing on the floor', () => {
    for (const spec of FURNITURE) {
      const piece = furnitureMesh(at(spec.kind), 7)
      piece.updateMatrixWorld(true)
      const box = new Box3().setFromObject(piece)
      expect(box.min.y).toBeCloseTo(7, 5)
      expect(box.max.y - 7).toBeGreaterThan(spec.h * 0.9)
      expect(box.max.y - 7).toBeLessThan(spec.h * 1.05 + 1e-6)
      expect(box.max.x - box.min.x).toBeLessThan(spec.w + 0.05)
      expect(box.max.z - box.min.z).toBeLessThan(spec.d + 0.05)
      expect(box.max.x - box.min.x).toBeGreaterThan(spec.w * 0.8)
      expect(box.max.z - box.min.z).toBeGreaterThan(spec.d * 0.8)
    }
  })

  it('turns like the plan: the same footprint corners as furnitureFootprint', () => {
    const f: Furniture = { kind: 'bed2', x: 3, z: -2, rot: 40 }
    const piece = furnitureMesh(f, 0)
    piece.updateMatrixWorld(true)
    const box = new Box3().setFromObject(piece)
    const ring = furnitureFootprint(f)
    expect(box.max.x).toBeLessThanOrEqual(Math.max(...ring.map((p) => p.x)) + 0.05)
    expect(box.min.x).toBeGreaterThanOrEqual(Math.min(...ring.map((p) => p.x)) - 0.05)
    expect(box.max.z).toBeLessThanOrEqual(Math.max(...ring.map((p) => p.z)) + 0.05)
    expect(box.min.z).toBeGreaterThanOrEqual(Math.min(...ring.map((p) => p.z)) - 0.05)
    // the headboard is at the back (-z locally), so the front corner (+z locally) lies on the footprint's front edge
    const front = new Vector3(0, 0.5, 1).applyMatrix4(piece.matrixWorld)
    const tipSide = furnitureFootprint(f)[2]
    expect(Math.hypot(front.x - f.x, front.z - f.z)).toBeCloseTo(1)
    expect(Math.hypot(tipSide.x - f.x, tipSide.z - f.z)).toBeGreaterThan(1)
  })

  it('shares geometry and materials between pieces of a kind, and casts and receives shadows (a rug only receives)', () => {
    const a = furnitureMesh(at('table'), 0)
    const b = furnitureMesh(at('table'), 0)
    const meshes = (g: Group) => g.children as Mesh[]
    meshes(a).forEach((m, i) => {
      expect(m.geometry).toBe(meshes(b)[i].geometry)
      expect(m.material).toBe(meshes(b)[i].material)
      expect(m.castShadow).toBe(true)
      expect(m.receiveShadow).toBe(true)
    })
    for (const m of meshes(furnitureMesh(at('rug'), 0))) expect(m.castShadow).toBe(false)
  })
})

describe('potted plants', () => {
  const pot = (plant: string, y?: number): Furniture => ({ kind: 'plant', x: 0, z: 0, rot: 0, plant, ...(y !== undefined && { y }) })
  const size = (f: Furniture, floorY = 0) => {
    const piece = furnitureMesh(f, floorY)
    piece.updateMatrixWorld(true)
    const box = new Box3().setFromObject(piece)
    return { width: Math.max(box.max.x - box.min.x, box.max.z - box.min.z), height: box.max.y - box.min.y, bottom: box.min.y, count: piece.children.length }
  }

  it('are 0.3 to 0.5 m wide and 0.3 to 1.2 m tall, whatever the kind', () => {
    for (const id of ['basil', 'tomato', 'nasturtium', 'lemon', 'pothos']) {
      const { width, height } = size(pot(id))
      expect(width).toBeGreaterThanOrEqual(0.3)
      expect(width).toBeLessThanOrEqual(0.5 + 1e-6)
      expect(height).toBeGreaterThanOrEqual(0.3)
      expect(height).toBeLessThanOrEqual(1.2)
    }
  })

  it('take their shape from the plant kind: bushes low, trees and houseplants taller, flowers with blooms', () => {
    const [herb, vegetable, flower, fruit, house] = ['basil', 'tomato', 'nasturtium', 'lemon', 'pothos'].map((id) => size(pot(id)))
    expect(herb.height).toBeLessThan(0.5)
    expect(vegetable.height).toBeLessThan(0.6)
    expect(fruit.height).toBeGreaterThan(0.9)
    expect(house.height).toBeGreaterThan(1)
    expect(flower.count).toBeGreaterThan(herb.count)
  })

  it('stand on the floor, or on their own height when they are off it', () => {
    expect(size(pot('basil'), 7).bottom).toBeCloseTo(7, 5)
    expect(size(pot('basil', 14.4), 7).bottom).toBeCloseTo(14.4, 5)
  })

  it('share meshes by kind, and fall back to the floor plant for a plant that is not known', () => {
    const a = furnitureMesh(pot('basil'), 0)
    const b = furnitureMesh(pot('parsley'), 0)
    expect((a.children[0] as Mesh).geometry).toBe((b.children[0] as Mesh).geometry)
    expect(size(pot('no-such-plant')).height).toBeCloseTo(size(at('plant')).height, 5)
    expect(furnitureMesh(pot('basil'), 0).userData.furnitureKind).toBe('plant')
  })
})

describe('furniture and the computed numbers', () => {
  const casting = (w: number): Mesh => {
    const m = new Mesh(new BoxGeometry(w, 1, 1), new MeshBasicMaterial())
    m.castShadow = true
    return m
  }
  const world = new Group()
  const trees = new Group()
  const furniture = new Group()
  world.add(casting(1))
  trees.add(casting(2))
  for (const kind of ['sofa', 'plant'] as const) furniture.add(furnitureMesh(at(kind), 0))
  const groups = { world, trees, furniture }
  const triangles = (roots: Group[]) => collectOccluders(roots).length / 9

  it('the pieces do cast shadows (so they shade the apartment in 3D)', () => {
    expect(triangles([furniture])).toBeGreaterThan(0)
  })

  it('leaves furniture out of the occluders every sun number is computed from', () => {
    const roots = occluderRoots(groups)
    expect(roots).toEqual([world, trees])
    expect(collectOccluders(roots).length).toBe(2 * 12 * 9)
  })

  it('has one flag to bring it in', () => {
    expect(occluderRoots(groups, true)).toEqual([world, trees, furniture])
    expect(triangles(occluderRoots(groups, true) as Group[])).toBeGreaterThan(24)
  })

  it('keys the scene differently with the switch on, whatever the version', () => {
    for (const version of [0, 1, 7, 8]) {
      expect(sceneKey(version, true)).not.toBe(sceneKey(version, false))
      expect(sceneKey(version + 1, false)).not.toBe(sceneKey(version, true))
      expect(sceneKey(version + 1, true)).not.toBe(sceneKey(version, false))
    }
    expect(sceneKey(3, true)).toBe(sceneKey(3, true))
  })
})
