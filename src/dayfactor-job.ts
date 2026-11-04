import { DAYLIGHT_CELL, HEMISPHERE_SAMPLES } from './dayfactor'
import { trianglesArea } from './dayfactor-trace'
import { t } from './i18n'
import type { Plan } from './plan'
import type { IrcCalibration } from './irc-gather'
import { ircInput, roomsKey, roomsOf } from './rooms'
import { floorGrid, type Grid } from './sunmap'
import type { WorkerIn, WorkerOut } from './sunmap.worker'

const CACHE_SIZE = 4

export interface DaylightRequest {
  /** Bumped by the scene whenever anything that can shade the apartment changes; it covers the plan too. */
  sceneVersion: number
  plan: Plan
  floorY: number
  /** Triangles of every occluder and of the window panes; only called when the worker does not hold this scene yet. */
  occluders(): Float32Array
  glass(): Float32Array
  cell?: number
  samples?: number
}

export interface DaylightResult {
  grid: Grid
  /** Daylight factor in %, per grid sample. */
  df: Float32Array
  /** The internally reflected part, %, per grid sample: gathered from the room's own surfaces, so it falls off away from the windows; 0 in a room without glass. */
  irc: Float32Array
  /** Per room: the raw gather mean, its scale to the BRE room mean, and the BRE value (empty without glass). */
  ircRooms: IrcCalibration[]
  glassArea: number
  ms: number
}

export type DaylightState =
  | { status: 'idle' }
  | { status: 'running'; progress: number }
  | { status: 'ready'; result: DaylightResult }
  | { status: 'error'; message: string }

export interface DaylightJob {
  /** Computes the estimate (at once when cached); a request for another scene stops the run in progress. */
  request(req: DaylightRequest): void
  /** Drops the pending or running request (the layer was switched off); the worker is freed. */
  stop(): void
  onState(listener: (state: DaylightState) => void): void
  dispose(): void
}

const keyOf = (r: DaylightRequest) => `${r.sceneVersion}|${r.cell ?? DAYLIGHT_CELL}|${r.samples ?? HEMISPHERE_SAMPLES}`

/**
 * The daylight estimate in a Web Worker of its own, freed when the layer is switched off: SC and ERC are traced per
 * floor point there; IRC is a closed formula per room (rooms.ts), added here. Cached per (scene, grid, samples), and a request with another
 * key (a scene change) stops the run in progress.
 */
export function createDaylightJob(): DaylightJob {
  const cache = new Map<string, DaylightResult>()
  let worker: Worker | undefined
  let workerScene = -1
  let listener: ((state: DaylightState) => void) | undefined
  let latest: DaylightRequest | undefined
  let running: { id: number; key: string; grid: Grid; glassArea: number; start: number } | undefined
  let nextId = 0

  const emit = (state: DaylightState) => listener?.(state)

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
      emit({ status: 'error', message: t('sun.dayError') })
    }
    return worker
  }

  function onWorker(m: WorkerOut) {
    if (!running || m.id !== running.id) return
    if (m.kind === 'progress') return emit({ status: 'running', progress: m.done })
    if (m.kind !== 'daylit' && m.kind !== 'error') return
    const job = running
    running = undefined
    if (m.kind === 'error') {
      workerScene = -1 // the next request sends the scene again
      if (m.message !== 'scene changed') emit({ status: 'error', message: m.message })
      return
    }
    const df = m.direct
    const irc = m.irc ?? new Float32Array(df.length)
    for (let i = 0; i < df.length; i++) df[i] += irc[i]
    const ms = performance.now() - job.start
    console.debug(`daylight: ${job.grid.count} points in ${ms.toFixed(0)} ms (BVH ${m.bvhMs.toFixed(0)} ms, rays ${m.ms.toFixed(0)} ms, IRC gather ${(m.ircMs ?? 0).toFixed(0)} ms), IRC ${Math.max(...irc).toFixed(2)} % at most`)
    const result = { grid: job.grid, df, irc, ircRooms: m.ircRooms ?? [], glassArea: job.glassArea, ms }
    cache.set(job.key, result)
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!)
    if (!latest || keyOf(latest) === job.key) emit({ status: 'ready', result })
  }

  return {
    request(req) {
      latest = req
      const key = keyOf(req)
      const hit = cache.get(key)
      if (hit) return emit({ status: 'ready', result: hit })
      if (running && running.key === key) return // already on it
      if (running) abort()
      const grid = floorGrid(req.plan, req.cell ?? DAYLIGHT_CELL)
      const glass = req.glass()
      const glassArea = trianglesArea(glass)
      if (!grid.count || !glass.length) {
        const result = { grid, df: new Float32Array(grid.count), irc: new Float32Array(grid.count), ircRooms: [], glassArea, ms: 0 }
        cache.set(key, result)
        return emit({ status: 'ready', result })
      }
      emit({ status: 'running', progress: 0 })
      try {
        const w = getWorker()
        if (workerScene !== req.sceneVersion) {
          const triangles = req.occluders()
          w.postMessage({ kind: 'scene', key: req.sceneVersion, triangles } satisfies WorkerIn, { transfer: [triangles.buffer] })
          w.postMessage({ kind: 'glass', key: req.sceneVersion, triangles: glass } satisfies WorkerIn, { transfer: [glass.buffer] })
          workerScene = req.sceneVersion
        }
        const points = new Float32Array(grid.count * 2)
        for (let s = 0; s < grid.count; s++) points.set([grid.xs[s], grid.zs[s]], s * 2)
        const id = ++nextId
        running = { id, key, grid, glassArea, start: performance.now() }
        const calib = Float32Array.from(points)
        const irc = ircInput(roomsOf(req.plan), req.floorY, calib, undefined, `${roomsKey(req.plan)}|${req.cell ?? DAYLIGHT_CELL}`)
        w.postMessage(
          { kind: 'daylight', id, key: req.sceneVersion, points, floorY: req.floorY, samples: req.samples ?? HEMISPHERE_SAMPLES, irc } satisfies WorkerIn,
          { transfer: [points.buffer] },
        )
      } catch (err) {
        running = undefined
        emit({ status: 'error', message: (err as Error).message })
      }
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
      abort()
    },
  }
}
