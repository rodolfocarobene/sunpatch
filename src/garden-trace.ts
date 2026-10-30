import { Ray, Vector3 } from 'three'
import { INTERSECTED, NOT_INTERSECTED, type MeshBVH } from 'three-mesh-bvh'
import type { YearSlots } from './panel-shade'

const hitPoint = new Vector3()

/**
 * Whether the ray toward the sun from the point is free. Like `seesSun` in sunmap-trace.ts, but it stops at the first
 * triangle in the way instead of looking for the nearest, which is about 40% faster over the thousands of rays of a map.
 */
function seesSun(bvh: MeshBVH, ray: Ray, x: number, y: number, z: number, dir: ArrayLike<number>, at: number): boolean {
  ray.origin.set(x, y, z)
  ray.direction.set(dir[at], dir[at + 1], dir[at + 2])
  let blocked = false
  bvh.shapecast({
    intersectsBounds: (box) => (ray.intersectsBox(box) ? INTERSECTED : NOT_INTERSECTED),
    intersectsTriangle: (tri) => {
      blocked = ray.intersectTriangle(tri.a, tri.b, tri.c, false, hitPoint) !== null // false: both faces block, as in seesSun
      return blocked
    },
  })
  return !blocked
}

/**
 * Mean daily direct-sun minutes per month for points `from` to `to` of `points` (x, y, z each): the 21st of each month
 * traced in slots of `step` minutes, a slot counting when the ray toward the sun from the point is free. Twelve
 * numbers per point, January first.
 */
export function traceMonthly(bvh: MeshBVH, points: Float32Array, slots: YearSlots, step: number, from: number, to: number): Float32Array {
  const out = new Float32Array((to - from) * 12)
  const ray = new Ray()
  const count = slots.start.length
  for (let s = from; s < to; s++) {
    const [x, y, z] = [points[s * 3], points[s * 3 + 1], points[s * 3 + 2]]
    for (let i = 0; i < count; i++) {
      if (seesSun(bvh, ray, x, y, z, slots.dirs, i * 3)) out[(s - from) * 12 + slots.month[i]] += step
    }
  }
  return out
}
