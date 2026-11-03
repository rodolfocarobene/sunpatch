import { BufferAttribute, BufferGeometry, DoubleSide, InstancedMesh, Matrix4, Ray, Vector3, type Mesh, type Object3D } from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import { SAMPLE_LIFT } from './sunmap'

/**
 * Triangles (nine numbers each, scene coordinates) of everything under `roots` that casts a shadow and is visible:
 * the same set the shadow maps draw. Glass panes never set castShadow, so they let the sun through. Instanced
 * meshes (trees) are expanded, one copy per instance.
 */
export function collectOccluders(roots: Object3D[]): Float32Array {
  const parts: Float32Array[] = []
  let length = 0
  const matrix = new Matrix4()
  const v = new Vector3()
  const add = (mesh: Mesh, instance?: Matrix4) => {
    const position = mesh.geometry.getAttribute('position')
    const index = mesh.geometry.getIndex()
    const count = index ? index.count : position.count
    const out = new Float32Array(count * 3)
    matrix.copy(mesh.matrixWorld)
    if (instance) matrix.multiply(instance)
    for (let i = 0; i < count; i++) {
      v.fromBufferAttribute(position, index ? index.getX(i) : i).applyMatrix4(matrix)
      out.set([v.x, v.y, v.z], i * 3)
    }
    parts.push(out)
    length += out.length
  }
  const instance = new Matrix4()
  for (const root of roots) {
    root.updateMatrixWorld(true)
    root.traverseVisible((o) => {
      const mesh = o as Mesh
      if (!mesh.isMesh || !mesh.castShadow) return
      if ((mesh as InstancedMesh).isInstancedMesh) {
        const instanced = mesh as InstancedMesh
        for (let i = 0; i < instanced.count; i++) {
          instanced.getMatrixAt(i, instance)
          add(mesh, instance)
        }
      } else add(mesh)
    })
  }
  const all = new Float32Array(length)
  let at = 0
  for (const part of parts) {
    all.set(part, at)
    at += part.length
  }
  return all
}

/** A BVH over a triangle soup (nine numbers per triangle). */
export function buildBvh(triangles: Float32Array): MeshBVH {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(triangles, 3))
  return new MeshBVH(geometry)
}

/** True when the ray from (x, y, z) toward the unit vector `dir` hits nothing: the point sees the sun. */
export function seesSun(bvh: MeshBVH, ray: Ray, x: number, y: number, z: number, dir: ArrayLike<number>, at = 0): boolean {
  ray.origin.set(x, y, z)
  ray.direction.set(dir[at], dir[at + 1], dir[at + 2])
  return !bvh.raycastFirst(ray, DoubleSide)
}

/**
 * Lit flags for every sample and slot: `points` holds x, z per sample on a floor at height `floorY`, `dirs` three
 * numbers per slot. Result index is sample * slots + slot. `progress` is called after every few samples with 0..1.
 */
export function traceSun(
  bvh: MeshBVH,
  points: Float32Array,
  floorY: number,
  dirs: Float32Array,
  progress?: (done: number) => void,
): Uint8Array {
  const samples = points.length / 2
  const slots = dirs.length / 3
  const lit = new Uint8Array(samples * slots)
  const ray = new Ray()
  const every = Math.max(1, Math.floor(samples / 40))
  for (let s = 0; s < samples; s++) {
    const x = points[s * 2]
    const z = points[s * 2 + 1]
    for (let i = 0; i < slots; i++) {
      lit[s * slots + i] = seesSun(bvh, ray, x, floorY + SAMPLE_LIFT, z, dirs, i * 3) ? 1 : 0
    }
    if (progress && s % every === 0) progress(s / samples)
  }
  return lit
}

/**
 * How many of `n` slots have a true flag, asking `test` for every `stride`-th slot only and for the slots between
 * two asked ones only when their answers differ. Stretches of sun (or shade) shorter than `stride` slots that fall
 * between two asked slots with the same answer are missed; edges are exact.
 */
export function countSparse(n: number, stride: number, test: (slot: number) => boolean): number {
  const flags = new Int8Array(n).fill(-1)
  const ask = (i: number) => (flags[i] = flags[i] >= 0 ? flags[i] : test(i) ? 1 : 0)
  const asked: number[] = []
  for (let i = 0; i < n; i += stride) asked.push(i)
  if (n > 0 && asked[asked.length - 1] !== n - 1) asked.push(n - 1)
  for (const i of asked) ask(i)
  for (let k = 1; k < asked.length; k++) {
    const a = asked[k - 1]
    const b = asked[k]
    for (let i = a + 1; i < b; i++) flags[i] = flags[a] === flags[b] ? flags[a] : ask(i)
  }
  return flags.reduce((sum, f) => sum + f, 0)
}

/**
 * How many of the slots (three numbers each in `dirs`) have at least one sample in the sun: the headline's count,
 * stopping at the first lit sample of a slot (the one that was lit in the last slot is tried first) and, in
 * stretches where the answer does not change, asking only every `stride`-th slot (see `countSparse`).
 */
export function litSlots(bvh: MeshBVH, points: Float32Array, floorY: number, dirs: Float32Array, stride = 1): number {
  const samples = points.length / 2
  const ray = new Ray()
  let hit = 0
  return countSparse(dirs.length / 3, stride, (i) => {
    for (let k = 0; k < samples; k++) {
      const s = (hit + k) % samples
      if (seesSun(bvh, ray, points[s * 2], floorY + SAMPLE_LIFT, points[s * 2 + 1], dirs, i * 3)) {
        hit = s
        return true
      }
    }
    return false
  })
}
