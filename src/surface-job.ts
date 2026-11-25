import { DAYLIGHT_CELL, HEMISPHERE_SAMPLES } from './dayfactor'
import { dateValue } from './daylight'
import { t } from './i18n'
import type { Point } from './osm'
import type { Plan } from './plan'
import { ircInput, rememberIrc, roomsKey, roomsOf } from './rooms'
import { dayStats, floorGrid, sunSlots, type SpotStats } from './sunmap'
import type { WorkerIn, WorkerOut } from './sunmap.worker'

const CACHE_SIZE = 8

type Vec3 = { x: number; y: number; z: number }

export interface SurfaceRequest {
  /** Bumped by the scene whenever anything that can shade the apartment changes; it covers the plan too. */
  sceneVersion: number
  plan: Plan
  floorY: number
  /** A point of a wall, a sill or a window reveal seen from the room, its unit normal into the room, and the floor point beside it (its room). */
  point: Vec3
  normal: Vec3
  room: Point
  /** The direct sun of a day, or the overcast daylight estimate. */
  ask: { kind: 'sun'; day: Date; lat: number; lon: number } | { kind: 'daylight' }
  /** Triangles of every occluder and of the window panes; only called when the worker does not hold this scene yet. */
  occluders(): Float32Array
  glass(): Float32Array
}

export type SurfaceAnswer = { kind: 'sun'; stats: SpotStats } | { kind: 'daylight'; df: number }

export type SurfaceState =
  | { status: 'idle' }
  | { status: 'running'; progress: number }
  | { status: 'ready'; answer: SurfaceAnswer }
  | { status: 'error'; message: string }

export interface SurfaceJob {
  /** Answers for this point (at once when cached); a request with another key stops the run in progress. */
  request(req: SurfaceRequest): void
  /** Drops the pending or running request (the popover closed). */
  stop(): void
  onState(listener: (state: SurfaceState) => void): void
  dispose(): void
}

const keyOf = (r: SurfaceRequest) =>
  [r.sceneVersion, r.point.x, r.point.y, r.point.z, r.normal.x, r.normal.y, r.normal.z].map((v) => v.toFixed(3)).join('|') +
  (r.ask.kind === 'sun' ? `|sun|${dateValue(r.ask.day)}|${r.ask.lat.toFixed(4)}|${r.ask.lon.toFixed(4)}` : '|daylight')

/**
 * One point of a surface inside the apartment, in a Web Worker of its own: the day's direct sun with the sun map's slots
 * (a slot counts when the sun is in front of the surface and nothing is in the way), or the daylight-factor estimate with
 * the floor layer's method about the surface's normal (the room means of the IRC come from the same floor grid, or from
 * an earlier run on this scene).
 */
export function createSurfaceJob(): SurfaceJob {
  const cache = new Map<string, SurfaceAnswer>()
  let worker: Worker | undefined
  let workerScene = -1
  let workerGlass = -1
  let listener: ((state: SurfaceState) => void) | undefined
  let latest: SurfaceRequest | undefined
  let running: { id: number; key: string; starts?: number[]; irc?: { scene: number; key: string } } | undefined
  let nextId = 0

  const emit = (state: SurfaceState) => listener?.(state)

  function abort() {
    running = undefined
    worker?.terminate()
    worker = undefined
    workerScene = -1
    workerGlass = -1
  }

  function getWorker(): Worker {
    if (worker) return worker
    worker = new Worker(new URL('./sunmap.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<WorkerOut>) => onWorker(e.data)
    worker.onerror = () => {
      abort()
      emit({ status: 'error', message: t('sun.mapError') })
    }
    return worker
  }

  function onWorker(m: WorkerOut) {
    if (!running || m.id !== running.id) return
    if (m.kind === 'progress') return emit({ status: 'running', progress: m.done })
    if (m.kind !== 'surfaced' && m.kind !== 'error') return
    const job = running
    running = undefined
    if (m.kind === 'error') {
      workerScene = -1 // the next request sends the scene again
      workerGlass = -1
      if (m.message !== 'scene changed') emit({ status: 'error', message: m.message })
      return
    }
    if (job.irc) rememberIrc(job.irc.scene, job.irc.key, m.ircRooms)
    const answer: SurfaceAnswer = m.lit && job.starts ? { kind: 'sun', stats: dayStats(m.lit, job.starts) } : { kind: 'daylight', df: m.df ?? 0 }
    console.debug(`surface point: ${answer.kind} in ${m.ms.toFixed(0)} ms`)
    cache.set(job.key, answer)
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!)
    if (latest && keyOf(latest) === job.key) emit({ status: 'ready', answer })
  }

  return {
    request(req) {
      latest = req
      const key = keyOf(req)
      const hit = cache.get(key)
      if (hit) return emit({ status: 'ready', answer: hit })
      if (running && running.key === key) return // already on it
      if (running) abort()
      const { point: p, normal: n, ask } = req
      const slots = ask.kind === 'sun' ? sunSlots(ask.day, ask.lat, ask.lon) : undefined
      const glass = ask.kind === 'daylight' ? req.glass() : undefined
      // A sunless day, or a daylight question in an apartment without windows: nothing to trace.
      const empty: SurfaceAnswer | undefined = slots && !slots.starts.length ? { kind: 'sun', stats: dayStats([], []) } : glass && !glass.length ? { kind: 'daylight', df: 0 } : undefined
      if (empty) {
        cache.set(key, empty)
        return emit({ status: 'ready', answer: empty })
      }
      emit({ status: 'running', progress: 0 })
      try {
        const w = getWorker()
        if (workerScene !== req.sceneVersion) {
          const triangles = req.occluders()
          w.postMessage({ kind: 'scene', key: req.sceneVersion, triangles } satisfies WorkerIn, { transfer: [triangles.buffer] })
          workerScene = req.sceneVersion
        }
        if (glass && workerGlass !== req.sceneVersion) {
          w.postMessage({ kind: 'glass', key: req.sceneVersion, triangles: glass } satisfies WorkerIn, { transfer: [glass.buffer] })
          workerGlass = req.sceneVersion
        }
        const id = ++nextId
        const point = Float32Array.from([p.x, p.y, p.z, n.x, n.y, n.z])
        if (slots) {
          running = { id, key, starts: slots.starts }
          w.postMessage({ kind: 'surface', id, key: req.sceneVersion, point, dirs: slots.dirs } satisfies WorkerIn)
          return
        }
        // The room means are held to BRE over the daylight layer's floor grid, so the surface reads on the same scale as the floor.
        const grid = floorGrid(req.plan, DAYLIGHT_CELL)
        const calib = new Float32Array(grid.count * 2)
        for (let i = 0; i < grid.count; i++) calib.set([grid.xs[i], grid.zs[i]], i * 2)
        const ircKey = `${roomsKey(req.plan)}|${DAYLIGHT_CELL}`
        const irc = ircInput(roomsOf(req.plan), req.floorY, calib, Float32Array.from([req.room.x, req.room.z]), ircKey, req.sceneVersion)
        running = { id, key, irc: { scene: req.sceneVersion, key: ircKey } }
        w.postMessage({ kind: 'surface', id, key: req.sceneVersion, point, daylight: { samples: HEMISPHERE_SAMPLES, irc: grid.count ? irc : undefined } } satisfies WorkerIn)
      } catch (err) {
        running = undefined
        emit({ status: 'error', message: (err as Error).message })
      }
    },
    stop() {
      latest = undefined
      if (running) abort()
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
