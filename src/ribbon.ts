import type { Point } from './osm'

export interface RibbonData {
  positions: number[]
  indices: number[]
}

const MITER_LIMIT = 2

/**
 * A flat strip of `width` metres centred on a closed ring, at height `y`, as triangles: two
 * vertices (left and right of the ring) per ring point, joined with mitres (capped at
 * MITER_LIMIT half-widths so sharp corners do not spike).
 */
export function ribbonData(ring: Point[], y: number, width: number): RibbonData {
  const n = ring.length
  const half = width / 2
  const positions: number[] = []
  const indices: number[] = []
  const unit = (a: Point, b: Point): Point => {
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1
    return { x: (b.x - a.x) / len, z: (b.z - a.z) / len }
  }
  for (let i = 0; i < n; i++) {
    const p = ring[i]
    const d0 = unit(ring[(i + n - 1) % n], p)
    const d1 = unit(p, ring[(i + 1) % n])
    // Normals of the two edges; their sum points along the mitre.
    const n0 = { x: -d0.z, z: d0.x }
    const n1 = { x: -d1.z, z: d1.x }
    let mx = n0.x + n1.x
    let mz = n0.z + n1.z
    const mlen = Math.hypot(mx, mz)
    if (mlen < 1e-9) {
      mx = n0.x
      mz = n0.z
    } else {
      mx /= mlen
      mz /= mlen
    }
    const cos = Math.max(mx * n0.x + mz * n0.z, 1 / MITER_LIMIT)
    const reach = half / cos
    positions.push(p.x + mx * reach, y, p.z + mz * reach, p.x - mx * reach, y, p.z - mz * reach)
  }
  for (let i = 0; i < n; i++) {
    const a = i * 2
    const b = ((i + 1) % n) * 2
    indices.push(a, a + 1, b, a + 1, b + 1, b)
  }
  return { positions, indices }
}

/** Ribbons for several rings merged into one buffer. */
export function ribbonsData(rings: Point[][], y: number, width: number): RibbonData {
  const positions: number[] = []
  const indices: number[] = []
  for (const ring of rings) {
    if (ring.length < 3) continue
    const r = ribbonData(ring, y, width)
    const offset = positions.length / 3
    positions.push(...r.positions)
    indices.push(...r.indices.map((i) => i + offset))
  }
  return { positions, indices }
}
