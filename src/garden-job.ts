import { yearSlots } from './panel-shade'
import { spotPoints, withSun, type GardenSpot, type SunnySpot } from './garden-spots'
import type { Plan } from './plan'
import type { WorkerIn, WorkerOut } from './sunmap.worker'

const DEBOUNCE_MS = 250
const CACHE_SIZE = 4
/** Minutes between slots when tracing the spots. */
export const GARDEN_SLOT_MINUTES = 15

export interface GardenRequest {
  /** Bumped by the scene whenever anything that can shade a spot changes (buildings, plan, edits, trees). */
  sceneVersion: number
  /** The plan the indoor spots come from (only its building and floor enter the cache key; edits bump the scene). */
  plan: Plan | undefined
  lat: number
  lon: number
  year: number
  /** The spots to trace; only called when this scene, plan and place are not cached. */
  spots(): GardenSpot[]
  /** Triangles of every occluder; only called when the worker does not hold this scene yet. */
  occluders(): Float32Array
}

export interface GardenResult {
  spots: SunnySpot[]
  /** Milliseconds the tracing took in the worker, and the BVH build. */
  ms: number
  bvhMs: number
}

export type GardenState =
  | { status: 'idle' }
  | { status: 'running'; progress: number }
  | { status: 'done'; result: GardenResult }
  | { status: 'error'; message: string }

export interface GardenJob {
  /** Computes the spots' sun for this request after a short pause (at once when cached); a newer request replaces it. */
  request(req: GardenRequest): void
  /** Forgets the pending request and the state shown. */
  stop(): void
  onState(listener: (state: GardenState) => void): void
  dispose(): void
}

export const gardenKey = (r: Pick<GardenRequest, 'sceneVersion' | 'plan' | 'lat' | 'lon' | 'year'>): string =>
  `${r.sceneVersion}|${r.plan ? `${r.plan.buildingId}/${r.plan.floor}` : '-'}|${r.lat.toFixed(4)}|${r.lon.toFixed(4)}|${r.year}`

/**
 * Runs the garden analysis in a Web Worker (the sun map's, an instance of its own): the worker traces the spots in
 * chunks and reports progress. Results are cached per (scene, plan, place, year); requests are debounced, and a newer
 * one with another key stops the run in progress.
 */
export function createGardenJob(): GardenJob {
  const cache = new Map<string, GardenResult>()
  let worker: Worker | undefined
  let workerScene = -1
  let listener: ((state: GardenState) => void) | undefined
  let timer: number | undefined
  let latest: GardenRequest | undefined
  let running: { id: number; key: string; spots: GardenSpot[] } | undefined
  let nextId = 0

  const emit = (state: GardenState) => listener?.(state)

  function getWorker(): Worker {
    if (worker) return worker
    worker = new Worker(new URL('./sunmap.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<WorkerOut>) => onWorker(e.data)
    worker.onerror = () => {
      running = undefined
      worker = undefined
      workerScene = -1
      emit({ status: 'error', message: 'The garden analysis could not run in this browser.' })
    }
    return worker
  }

  function onWorker(m: WorkerOut) {
    if (!running || m.id !== running.id) return
    if (m.kind === 'progress') return emit({ status: 'running', progress: m.done })
    if (m.kind !== 'gardened' && m.kind !== 'error') return
    const job = running
    running = undefined
    if (m.kind === 'error') {
      workerScene = -1 // the next request sends the scene again
      if (m.message !== 'scene changed') emit({ status: 'error', message: m.message })
    } else {
      console.debug(`garden: ${job.spots.length} spots in ${m.ms.toFixed(0)} ms`)
      const result = { spots: withSun(job.spots, m.minutes), ms: m.ms, bvhMs: m.bvhMs }
      cache.set(job.key, result)
      if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!)
      if (!latest || gardenKey(latest) === job.key) emit({ status: 'done', result })
    }
  }

  /** Drops the run in progress: its worker is stopped and starts afresh for the next one. */
  function abort() {
    if (!running) return
    running = undefined
    worker?.terminate()
    worker = undefined
    workerScene = -1
  }

  function run(req: GardenRequest) {
    const key = gardenKey(req)
    const hit = cache.get(key)
    if (hit) return emit({ status: 'done', result: hit })
    if (running) return // the same request is already running
    emit({ status: 'running', progress: 0 })
    try {
      const w = getWorker()
      if (workerScene !== req.sceneVersion) {
        const triangles = req.occluders()
        w.postMessage({ kind: 'scene', key: req.sceneVersion, triangles } satisfies WorkerIn, { transfer: [triangles.buffer] })
        workerScene = req.sceneVersion
      }
      const spots = req.spots()
      const id = ++nextId
      running = { id, key, spots }
      w.postMessage({
        kind: 'garden', id, key: req.sceneVersion, points: spotPoints(spots),
        slots: yearSlots(req.lat, req.lon, req.year, GARDEN_SLOT_MINUTES), step: GARDEN_SLOT_MINUTES,
      } satisfies WorkerIn)
    } catch (err) {
      running = undefined
      emit({ status: 'error', message: (err as Error).message })
    }
  }

  return {
    request(req) {
      latest = req
      window.clearTimeout(timer)
      const key = gardenKey(req)
      const hit = cache.get(key)
      if (hit) return emit({ status: 'done', result: hit })
      if (running && running.key !== key) abort()
      emit({ status: 'running', progress: 0 })
      timer = window.setTimeout(() => run(req), DEBOUNCE_MS)
    },
    stop() {
      window.clearTimeout(timer)
      latest = undefined
      abort()
      emit({ status: 'idle' })
    },
    onState(fn) {
      listener = fn
    },
    dispose() {
      window.clearTimeout(timer)
      worker?.terminate()
      worker = undefined
    },
  }
}
