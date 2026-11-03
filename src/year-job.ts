import { STEP } from './daylight'
import { t } from './i18n'
import type { Plan } from './plan'
import { floorGrid, sunSlots } from './sunmap'
import type { WorkerIn, WorkerOut } from './sunmap.worker'
import { yearDays } from './year'

const DEBOUNCE_MS = 250
const CACHE_SIZE = 4
/** The headline's coarse grid: only "is any spot lit" is asked, so the year matches the headline of the same day. */
export const YEAR_CELL = 0.5

export interface YearRequest {
  /** Bumped by the scene whenever anything that can shade the apartment changes. */
  sceneVersion: number
  plan: Plan
  floorY: number
  year: number
  lat: number
  lon: number
  /** Triangles of every occluder; only called when the worker does not hold this scene yet. */
  occluders(): Float32Array
}

export type YearState =
  | { status: 'idle' }
  | { status: 'running'; progress: number }
  | { status: 'ready'; minutes: number[]; ms: number }
  | { status: 'error'; message: string }

export interface YearJob {
  request(req: YearRequest): void
  /** Drops the pending or running request (the chart was closed or the view left); the worker is freed. */
  stop(): void
  onState(listener: (state: YearState) => void): void
  dispose(): void
}

const keyOf = (r: YearRequest) => `${r.sceneVersion}|${r.plan.buildingId}/${r.plan.floor}|${r.lat.toFixed(4)}|${r.lon.toFixed(4)}|${r.year}`

/**
 * The year chart's tracing, in a Web Worker of its own (freed when the chart closes): the 21st of each month at the
 * sun map's 5-minute slots, minutes with any floor sample lit. Cached per (scene, floor, place, year); a request with
 * another key (a scene change) stops the run in progress.
 */
export function createYearJob(): YearJob {
  const cache = new Map<string, number[]>()
  let worker: Worker | undefined
  let workerScene = -1
  let listener: ((state: YearState) => void) | undefined
  let timer: number | undefined
  let latest: YearRequest | undefined
  let running: { id: number; key: string } | undefined
  let nextId = 0

  const emit = (state: YearState) => listener?.(state)

  function abort() {
    running = undefined
    worker?.terminate()
    worker = undefined
    workerScene = -1
  }

  function getWorker(): Worker {
    if (worker) return worker
    worker = new Worker(new URL('./sunmap.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<WorkerOut>) => onWorker(e.data)
    worker.onerror = () => {
      abort()
      emit({ status: 'error', message: t('year.error') })
    }
    return worker
  }

  function onWorker(m: WorkerOut) {
    if (!running || m.id !== running.id) return
    if (m.kind === 'progress') return emit({ status: 'running', progress: m.done })
    if (m.kind !== 'yeared' && m.kind !== 'error') return
    const job = running
    running = undefined
    if (m.kind === 'error') {
      workerScene = -1 // the next request sends the scene again
      if (m.message !== 'scene changed') emit({ status: 'error', message: m.message })
      return
    }
    const minutes = m.lit.map((n) => n * STEP)
    console.debug(`year: 12 days in ${m.ms.toFixed(0)} ms (BVH ${m.bvhMs.toFixed(0)} ms)`)
    cache.set(job.key, minutes)
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!)
    if (!latest || keyOf(latest) === job.key) emit({ status: 'ready', minutes, ms: m.ms })
  }

  function run(req: YearRequest) {
    const key = keyOf(req)
    const hit = cache.get(key)
    if (hit) return emit({ status: 'ready', minutes: hit, ms: 0 })
    if (running) return
    const grid = floorGrid(req.plan, YEAR_CELL)
    const days = yearDays(req.year).map((d) => sunSlots(d, req.lat, req.lon))
    const counts = days.map((d) => d.starts.length)
    if (!grid.count) return emit({ status: 'ready', minutes: counts.map(() => 0), ms: 0 })
    emit({ status: 'running', progress: 0 })
    try {
      const w = getWorker()
      if (workerScene !== req.sceneVersion) {
        const triangles = req.occluders()
        w.postMessage({ kind: 'scene', key: req.sceneVersion, triangles } satisfies WorkerIn, { transfer: [triangles.buffer] })
        workerScene = req.sceneVersion
      }
      const points = new Float32Array(grid.count * 2)
      for (let s = 0; s < grid.count; s++) points.set([grid.xs[s], grid.zs[s]], s * 2)
      const dirs = new Float32Array(counts.reduce((a, b) => a + b, 0) * 3)
      let at = 0
      for (const d of days) {
        dirs.set(d.dirs, at)
        at += d.dirs.length
      }
      const id = ++nextId
      running = { id, key }
      w.postMessage({ kind: 'year', id, key: req.sceneVersion, points, floorY: req.floorY, dirs, counts } satisfies WorkerIn, { transfer: [points.buffer, dirs.buffer] })
    } catch (err) {
      running = undefined
      emit({ status: 'error', message: (err as Error).message })
    }
  }

  return {
    request(req) {
      latest = req
      window.clearTimeout(timer)
      const key = keyOf(req)
      const hit = cache.get(key)
      if (hit) return emit({ status: 'ready', minutes: hit, ms: 0 })
      if (running && running.key === key) return // already on it
      if (running) abort()
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
      abort()
    },
  }
}
