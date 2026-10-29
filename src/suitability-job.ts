import { yearSlots } from './panel-shade'
import { SUITABILITY_SLOT_MINUTES, rayInputs, type SurfaceSample } from './suitability'
import type { WorkerIn, WorkerOut } from './sunmap.worker'

const CACHE_SIZE = 4

export interface SuitabilityRequest {
  /** Bumped by the scene whenever anything that can shade a surface changes (buildings, plan, edits, trees). */
  sceneVersion: number
  lat: number
  lon: number
  year: number
  /** The surfaces to trace; only called when this scene and place are not cached. */
  samples(): SurfaceSample[]
  /** Triangles of every occluder; only called when the worker does not hold this scene yet. */
  occluders(): Float32Array
}

export interface SuitabilityResult {
  samples: SurfaceSample[]
  /** IRRADIATION_STRIDE numbers per sample (see traceSamples). */
  irradiation: Float32Array
  /** Milliseconds the tracing took in the worker, and the rays-free BVH build. */
  ms: number
  bvhMs: number
}

export type SuitabilityState =
  | { status: 'idle' }
  | { status: 'computing'; progress: number }
  | { status: 'ready'; result: SuitabilityResult }
  | { status: 'error'; message: string }

export interface SuitabilityJob {
  /** Computes the map for this scene and place (at once when cached); a newer request replaces a waiting one. */
  request(req: SuitabilityRequest): void
  /** Forgets the pending request and the state shown (the map was switched off). */
  stop(): void
  onState(listener: (state: SuitabilityState) => void): void
  dispose(): void
}

const keyOf = (r: Pick<SuitabilityRequest, 'sceneVersion' | 'lat' | 'lon' | 'year'>): string =>
  `${r.sceneVersion}|${r.lat.toFixed(4)}|${r.lon.toFixed(4)}|${r.year}`

/**
 * Runs the suitability map in a Web Worker (the one the sun map uses, an instance of its own): the worker traces the
 * samples in chunks and reports progress. Results are cached per (scene, place); a newer request stops the run
 * in progress.
 */
export function createSuitabilityJob(): SuitabilityJob {
  const cache = new Map<string, SuitabilityResult>()
  let worker: Worker | undefined
  let workerScene = -1
  let listener: ((state: SuitabilityState) => void) | undefined
  let latest: SuitabilityRequest | undefined
  let running: { id: number; key: string; samples: SurfaceSample[] } | undefined
  let nextId = 0

  const emit = (state: SuitabilityState) => listener?.(state)

  function getWorker(): Worker {
    if (worker) return worker
    worker = new Worker(new URL('./sunmap.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<WorkerOut>) => onWorker(e.data)
    worker.onerror = () => {
      running = undefined
      worker = undefined
      workerScene = -1
      emit({ status: 'error', message: 'The suitability map could not run in this browser.' })
    }
    return worker
  }

  function onWorker(m: WorkerOut) {
    if (!running || m.id !== running.id) return
    if (m.kind === 'progress') return emit({ status: 'computing', progress: m.done })
    if (m.kind !== 'suited' && m.kind !== 'error') return
    const job = running
    running = undefined
    if (m.kind === 'error') {
      workerScene = -1 // the next request sends the scene again
      if (m.message !== 'scene changed') emit({ status: 'error', message: m.message })
    } else {
      console.debug(`suitability: ${job.samples.length} samples in ${m.ms.toFixed(0)} ms`)
      const result = { samples: job.samples, irradiation: m.irradiation, ms: m.ms, bvhMs: m.bvhMs }
      cache.set(job.key, result)
      if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!)
      if (!latest || keyOf(latest) === job.key) emit({ status: 'ready', result })
    }
  }

  /** Drops the run in progress: its worker is stopped (a map takes seconds) and starts afresh for the next one. */
  function abort() {
    if (!running) return
    running = undefined
    worker?.terminate()
    worker = undefined
    workerScene = -1
  }

  function run(req: SuitabilityRequest) {
    const key = keyOf(req)
    const hit = cache.get(key)
    if (hit) return emit({ status: 'ready', result: hit })
    if (running) return // the same request is already running
    emit({ status: 'computing', progress: 0 })
    try {
      const w = getWorker()
      if (workerScene !== req.sceneVersion) {
        const triangles = req.occluders()
        w.postMessage({ kind: 'scene', key: req.sceneVersion, triangles } satisfies WorkerIn, { transfer: [triangles.buffer] })
        workerScene = req.sceneVersion
      }
      const samples = req.samples()
      const id = ++nextId
      running = { id, key, samples }
      w.postMessage({
        kind: 'suit', id, key: req.sceneVersion, inputs: rayInputs(samples),
        slots: yearSlots(req.lat, req.lon, req.year, SUITABILITY_SLOT_MINUTES), step: SUITABILITY_SLOT_MINUTES,
      } satisfies WorkerIn)
    } catch (err) {
      running = undefined
      emit({ status: 'error', message: (err as Error).message })
    }
  }

  return {
    request(req) {
      latest = req
      if (running && running.key !== keyOf(req)) abort()
      run(req)
    },
    stop() {
      latest = undefined
      abort()
      emit({ status: 'idle' })
    },
    onState(fn) {
      listener = fn
    },
    dispose() {
      worker?.terminate()
      worker = undefined
    },
  }
}
