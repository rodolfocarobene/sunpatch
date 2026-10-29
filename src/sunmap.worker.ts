import type { MeshBVH } from 'three-mesh-bvh'
import { buildBvh, traceSun } from './sunmap-trace'

export type WorkerIn =
  | { kind: 'scene'; key: number; triangles: Float32Array }
  | { kind: 'trace'; id: number; key: number; points: Float32Array; floorY: number; dirs: Float32Array }

export type WorkerOut =
  | { kind: 'progress'; id: number; done: number }
  | { kind: 'done'; id: number; lit: Uint8Array; ms: number; bvhMs: number }
  | { kind: 'error'; id: number; message: string }

// The BVH is built once per scene and kept for every date asked afterwards.
let bvh: MeshBVH | undefined
let bvhKey = -1
let bvhMs = 0

const reply = (message: WorkerOut, transfer: Transferable[] = []) => self.postMessage(message, { transfer })

self.onmessage = (e: MessageEvent<WorkerIn>) => {
  const m = e.data
  if (m.kind === 'scene') {
    const built = performance.now()
    bvh = buildBvh(m.triangles)
    bvhMs = performance.now() - built
    bvhKey = m.key
    return
  }
  try {
    if (!bvh || bvhKey !== m.key) throw new Error('scene not loaded')
    const start = performance.now()
    const lit = traceSun(bvh, m.points, m.floorY, m.dirs, (done) => reply({ kind: 'progress', id: m.id, done }))
    reply({ kind: 'done', id: m.id, lit, ms: performance.now() - start, bvhMs }, [lit.buffer])
  } catch (err) {
    reply({ kind: 'error', id: m.id, message: (err as Error).message })
  }
}
