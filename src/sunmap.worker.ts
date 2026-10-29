import type { MeshBVH } from 'three-mesh-bvh'
import type { Panel } from './plan'
import { shadePanel, type PanelShade, type YearSlots } from './panel-shade'
import { buildBvh, traceSun } from './sunmap-trace'
import { IRRADIATION_STRIDE, traceSamples } from './suitability'

export type WorkerIn =
  | { kind: 'scene'; key: number; triangles: Float32Array }
  | { kind: 'trace'; id: number; key: number; points: Float32Array; floorY: number; dirs: Float32Array }
  | { kind: 'shade'; id: number; key: number; panel: Panel; slots: YearSlots }
  | { kind: 'suit'; id: number; key: number; inputs: Float32Array; slots: YearSlots; step: number }

export type WorkerOut =
  | { kind: 'progress'; id: number; done: number }
  | { kind: 'done'; id: number; lit: Uint8Array; ms: number; bvhMs: number }
  | { kind: 'shaded'; id: number; shade: PanelShade; bvhMs: number }
  | { kind: 'suited'; id: number; irradiation: Float32Array; ms: number; bvhMs: number }
  | { kind: 'error'; id: number; message: string }

// The BVH is built once per scene and kept for every date (sun map) or panel (shading analysis) asked afterwards.
let bvh: MeshBVH | undefined
let bvhKey = -1
let bvhMs = 0

/** Samples traced per turn of the suitability map; between turns the worker can take a newer request. */
const SUIT_CHUNK = 400
let suitId = -1

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
    if (m.kind === 'suit') {
      suit(m)
      return
    }
    if (m.kind === 'shade') {
      reply({ kind: 'shaded', id: m.id, shade: shadePanel(bvh, m.panel, m.slots), bvhMs })
      return
    }
    const start = performance.now()
    const lit = traceSun(bvh, m.points, m.floorY, m.dirs, (done) => reply({ kind: 'progress', id: m.id, done }))
    reply({ kind: 'done', id: m.id, lit, ms: performance.now() - start, bvhMs }, [lit.buffer])
  } catch (err) {
    reply({ kind: 'error', id: m.id, message: (err as Error).message })
  }
}

/** The suitability map in chunks, reporting progress; a newer 'suit' request (or scene) stops this one. */
function suit(m: Extract<WorkerIn, { kind: 'suit' }>) {
  suitId = m.id
  const total = m.inputs.length / 6
  const out = new Float32Array(total * IRRADIATION_STRIDE)
  const started = performance.now()
  let at = 0
  const turn = () => {
    if (suitId !== m.id) return
    try {
      if (!bvh || bvhKey !== m.key) throw new Error('scene changed')
      const to = Math.min(total, at + SUIT_CHUNK)
      out.set(traceSamples(bvh, m.inputs, m.slots, m.step, at, to), at * IRRADIATION_STRIDE)
      at = to
    } catch (err) {
      reply({ kind: 'error', id: m.id, message: (err as Error).message })
      return
    }
    if (at < total) {
      reply({ kind: 'progress', id: m.id, done: at / total })
      setTimeout(turn, 0)
    } else reply({ kind: 'suited', id: m.id, irradiation: out, ms: performance.now() - started, bvhMs }, [out.buffer])
  }
  turn()
}
