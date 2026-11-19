import { Box3, BoxGeometry, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { FURNITURE, furnitureFootprint, type Furniture } from './furniture'
import { furnitureMesh } from './furniture-mesh'
import { collectOccluders, occluderRoots } from './sunmap-trace'

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
})
