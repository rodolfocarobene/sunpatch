import { Ray } from 'three'
import type { MeshBVH } from 'three-mesh-bvh'
import type { YearSlots } from './panel-shade'
import { seesSun } from './sunmap-trace'

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
