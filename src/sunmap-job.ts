import { dateValue, STEP } from './daylight'
import type { Plan } from './plan'
import { floorGrid, sunSlots, type Grid, type Slots, type SunMapResult } from './sunmap'
import type { WorkerIn, WorkerOut } from './sunmap.worker'

const DEBOUNCE_MS = 250
const CACHE_SIZE = 12

export interface SunMapRequest {
  /** Bumped by the scene whenever anything that can shade the apartment changes (buildings, plan, edits, trees). */
  sceneVersion: number
  plan: Plan
  /** Height of the floor surface. */
  floorY: number
  day: Date
  lat: number
  lon: number
  /** Triangles of every occluder; only called when the worker does not hold this scene yet. */
  occluders(): Float32Array
}

export type SunMapState =
  | { status: 'idle' }
  | { status: 'computing'; progress: number }
  | { status: 'ready'; result: SunMapResult }
  | { status: 'error'; message: string }

export interface SunMapJob {
  /** Computes the sun map for this request after a short pause (or at once when cached); newer requests replace it. */
  request(req: SunMapRequest): void
  /** Forgets the pending request and the state shown (the map was switched off). */
  stop(): void
  onState(listener: (state: SunMapState) => void): void
  dispose(): void
}

/** The scene version covers the plan too: every plan, building, edit or tree change goes through the scene. */
const keyOf = (r: SunMapRequest) => `${r.sceneVersion}|${dateValue(r.day)}|${r.lat.toFixed(4)}|${r.lon.toFixed(4)}`

/**
 * Runs the sun map in a Web Worker: the triangles go over once per scene (the worker keeps the BVH), each date
 * only sends the sample points and sun directions. Results are cached per (scene, plan, date, place) and a request
 * made while one runs waits for it and replaces any earlier waiting one.
 */
export function createSunMapJob(): SunMapJob {
  const cache = new Map<string, SunMapResult>()
  let worker: Worker | undefined
  let workerScene = -1
  let listener: ((state: SunMapState) => void) | undefined
  let timer: number | undefined
  let latest: SunMapRequest | undefined
  let running: { id: number; key: string; start: number; grid: Grid; slots: Slots } | undefined
  let nextId = 0

  const emit = (state: SunMapState) => listener?.(state)

  function ready(key: string, grid: Grid, slots: Slots, lit: Uint8Array, ms: number) {
    const result = { grid, starts: slots.starts, lit, daylightMinutes: slots.starts.length * STEP, ms }
    cache.set(key, result)
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!)
    // A result for a request that has been replaced is kept for later but not shown.
    if (!latest || keyOf(latest) === key) emit({ status: 'ready', result })
  }

  function getWorker(): Worker {
    if (worker) return worker
    worker = new Worker(new URL('./sunmap.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<WorkerOut>) => onWorker(e.data)
    worker.onerror = () => {
      running = undefined
      worker = undefined
      workerScene = -1
      emit({ status: 'error', message: 'The sun map could not run in this browser.' })
    }
    return worker
  }

  function onWorker(m: WorkerOut) {
    if (!running || m.id !== running.id) return
    if (m.kind === 'shaded') return // answers for the panel job's own worker
    if (m.kind === 'progress') {
      emit({ status: 'computing', progress: m.done })
      return
    }
    const job = running
    running = undefined
    if (m.kind === 'error') {
      workerScene = -1 // the next request sends the scene again
      emit({ status: 'error', message: m.message })
    } else {
      const ms = performance.now() - job.start
      console.debug(`sun map: ${job.grid.count} samples x ${job.slots.starts.length} slots in ${ms.toFixed(0)} ms (BVH ${m.bvhMs.toFixed(0)} ms, rays ${m.ms.toFixed(0)} ms)`)
      ready(job.key, job.grid, job.slots, m.lit, ms)
    }
    // A newer request came in while this one ran.
    if (latest && keyOf(latest) !== job.key) run(latest)
  }

  function run(req: SunMapRequest) {
    const key = keyOf(req)
    const hit = cache.get(key)
    if (hit) {
      emit({ status: 'ready', result: hit })
      return
    }
    if (running) return // finished results pick up `latest`
    const start = performance.now()
    const grid = floorGrid(req.plan)
    const slots = sunSlots(req.day, req.lat, req.lon)
    if (!grid.count || !slots.starts.length) {
      ready(key, grid, slots, new Uint8Array(grid.count * slots.starts.length), 0)
      return
    }
    emit({ status: 'computing', progress: 0 })
    try {
      const w = getWorker()
      if (workerScene !== req.sceneVersion) {
        const triangles = req.occluders()
        w.postMessage({ kind: 'scene', key: req.sceneVersion, triangles } satisfies WorkerIn, { transfer: [triangles.buffer] })
        workerScene = req.sceneVersion
      }
      const points = new Float32Array(grid.count * 2)
      for (let s = 0; s < grid.count; s++) points.set([grid.xs[s], grid.zs[s]], s * 2)
      const id = ++nextId
      running = { id, key, start, grid, slots }
      w.postMessage({ kind: 'trace', id, key: req.sceneVersion, points, floorY: req.floorY, dirs: slots.dirs } satisfies WorkerIn, {
        transfer: [points.buffer],
      })
    } catch (err) {
      running = undefined
      emit({ status: 'error', message: (err as Error).message })
    }
  }

  return {
    request(req) {
      latest = req
      window.clearTimeout(timer)
      const hit = cache.get(keyOf(req))
      if (hit) {
        emit({ status: 'ready', result: hit })
        return
      }
      emit({ status: 'computing', progress: 0 })
      timer = window.setTimeout(() => run(req), DEBOUNCE_MS)
    },
    stop() {
      window.clearTimeout(timer)
      latest = undefined
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
