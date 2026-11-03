import { DoubleSide, Ray, type BufferGeometry } from 'three'
import type { MeshBVH } from 'three-mesh-bvh'
import { cieWeight, hemisphereDirs, sampleDaylight, WORK_PLANE } from './dayfactor'

/** Triangles (nine numbers each) of the window panes, which are not shadow casters and so are not in the occluders. */
export function glassTriangles(panes: BufferGeometry[]): Float32Array {
  const parts: number[] = []
  for (const g of panes) {
    const p = g.getAttribute('position')
    const index = g.getIndex()
    const count = index ? index.count : p.count
    for (let i = 0; i < count; i++) {
      const v = index ? index.getX(i) : i
      parts.push(p.getX(v), p.getY(v), p.getZ(v))
    }
  }
  return Float32Array.from(parts)
}

/** Total area of a triangle soup, m2. */
export function trianglesArea(t: Float32Array): number {
  let sum = 0
  for (let i = 0; i < t.length; i += 9) {
    const ux = t[i + 3] - t[i]
    const uy = t[i + 4] - t[i + 1]
    const uz = t[i + 5] - t[i + 2]
    const vx = t[i + 6] - t[i]
    const vy = t[i + 7] - t[i + 1]
    const vz = t[i + 8] - t[i + 2]
    sum += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2
  }
  return sum
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5))

/**
 * The direct parts of the daylight factor (SC + ERC, %) for points `from..to` of `points` (x, z each) on a floor at
 * `floorY`, written to `out[from..to)`. From the work plane, `samples` cosine-distributed directions go up; one that
 * crosses a window pane before anything else counts as sky (CIE-weighted) when nothing is in the way beyond the
 * glass, and as an obstruction (ERC) when something is. `glass` is a BVH of the panes, `occluders` the scene's.
 * Rays never go below the horizon, so the ground adds nothing beyond ERC's rule for obstructions.
 */
export function traceDaylight(
  occluders: MeshBVH,
  glass: MeshBVH,
  points: Float32Array,
  floorY: number,
  samples: number,
  from: number,
  to: number,
  out: Float32Array,
): void {
  const dirs = hemisphereDirs(samples)
  const weights = Float32Array.from({ length: samples }, (_, i) => cieWeight(dirs[i * 3 + 1]))
  const ray = new Ray()
  const y = floorY + WORK_PLANE
  for (let s = from; s < to; s++) {
    // A different turn per point, so the even spiral does not stripe the floor.
    const turn = (s * GOLDEN) % (Math.PI * 2)
    const c = Math.cos(turn)
    const sn = Math.sin(turn)
    ray.origin.set(points[s * 2], y, points[s * 2 + 1])
    let sky = 0
    let obstructed = 0
    for (let i = 0; i < samples; i++) {
      const dx = dirs[i * 3]
      const dz = dirs[i * 3 + 2]
      ray.direction.set(dx * c - dz * sn, dirs[i * 3 + 1], dx * sn + dz * c)
      const pane = glass.raycastFirst(ray, DoubleSide)
      if (!pane) continue
      const hit = occluders.raycastFirst(ray, DoubleSide)
      if (!hit) sky += weights[i]
      else if (hit.distance > pane.distance) obstructed++
    }
    const { sc, erc } = sampleDaylight(sky / samples, obstructed / samples)
    out[s] = sc + erc
  }
}
