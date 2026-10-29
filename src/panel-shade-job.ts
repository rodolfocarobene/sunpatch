import type { Panel } from './plan'
import { yearSlots, type PanelShade } from './panel-shade'
import type { WorkerIn, WorkerOut } from './sunmap.worker'

const DEBOUNCE_MS = 250
const CACHE_SIZE = 40

export interface PanelShadeRequest {
  /** Bumped by the scene whenever anything that can shade the panel changes (buildings, plan, edits, trees). */
  sceneVersion: number
  panel: Panel
  lat: number
  lon: number
  year: number
  /** Triangles of every occluder; only called when the worker does not hold this scene yet. */
  occluders(): Float32Array
}

export type PanelShadeState =
  | { status: 'idle' }
  | { status: 'computing'; key: string }
  | { status: 'ready'; key: string; shade: PanelShade }
  | { status: 'error'; message: string }

export interface PanelShadeJob {
  /** Computes the analysis for this request after a short pause (or at once when cached); newer requests replace it. */
  request(req: PanelShadeRequest): void
  /** Forgets the pending request and the state shown (no panel is selected). */
  stop(): void
  onState(listener: (state: PanelShadeState) => void): void
  dispose(): void
}

/** Cache key: scene version, the panel's parameters (not its id) and the place. */
export const shadeKey = (r: Pick<PanelShadeRequest, 'sceneVersion' | 'panel' | 'lat' | 'lon' | 'year'>): string => {
  const p = r.panel
  const geometry = [p.x, p.z, p.elevation, p.width, p.height, p.tilt, p.azimuth, p.count ?? 1].join(',')
  return `${r.sceneVersion}|${geometry}|${r.lat.toFixed(4)}|${r.lon.toFixed(4)}|${r.year}`
}

/**
 * Runs the shading analysis of one panel in a Web Worker with its own copy of the scene's BVH (the triangles go over
 * once per scene). Results are cached per (scene, panel, place); requests are debounced and one runs at a time, a
 * newer one waiting for it and replacing any earlier waiting one.
 */
export function createPanelShadeJob(): PanelShadeJob {
  const cache = new Map<string, PanelShade>()
  let worker: Worker | undefined
  let workerScene = -1
  let listener: ((state: PanelShadeState) => void) | undefined
  let timer: number | undefined
  let latest: PanelShadeRequest | undefined
  let running: { id: number; key: string; start: number } | undefined
  let nextId = 0

  const emit = (state: PanelShadeState) => listener?.(state)

  function getWorker(): Worker {
    if (worker) return worker
    worker = new Worker(new URL('./sunmap.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<WorkerOut>) => onWorker(e.data)
    worker.onerror = () => {
      running = undefined
      worker = undefined
      workerScene = -1
      emit({ status: 'error', message: 'The shading analysis could not run in this browser.' })
    }
    return worker
  }

  function onWorker(m: WorkerOut) {
    if (!running || m.id !== running.id) return
    if (m.kind !== 'shaded' && m.kind !== 'error') return
    const job = running
    running = undefined
    if (m.kind === 'error') {
      workerScene = -1 // the next request sends the scene again
      emit({ status: 'error', message: m.message })
    } else {
      const ms = performance.now() - job.start
      console.debug(`panel shade: ${m.shade.rays} rays in ${ms.toFixed(0)} ms (BVH ${m.bvhMs.toFixed(0)} ms, rays ${m.shade.ms.toFixed(0)} ms)`)
      cache.set(job.key, m.shade)
      if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!)
      // A result for a request that has been replaced is kept for later but not shown.
      if (!latest || shadeKey(latest) === job.key) emit({ status: 'ready', key: job.key, shade: m.shade })
    }
    if (latest && shadeKey(latest) !== job.key) run(latest) // a newer request came in while this one ran
  }

  function run(req: PanelShadeRequest) {
    const key = shadeKey(req)
    const hit = cache.get(key)
    if (hit) {
      emit({ status: 'ready', key, shade: hit })
      return
    }
    if (running) return // finished results pick up `latest`
    emit({ status: 'computing', key })
    try {
      const w = getWorker()
      if (workerScene !== req.sceneVersion) {
        const triangles = req.occluders()
        w.postMessage({ kind: 'scene', key: req.sceneVersion, triangles } satisfies WorkerIn, { transfer: [triangles.buffer] })
        workerScene = req.sceneVersion
      }
      const id = ++nextId
      running = { id, key, start: performance.now() }
      w.postMessage({ kind: 'shade', id, key: req.sceneVersion, panel: req.panel, slots: yearSlots(req.lat, req.lon, req.year) } satisfies WorkerIn)
    } catch (err) {
      running = undefined
      emit({ status: 'error', message: (err as Error).message })
    }
  }

  return {
    request(req) {
      latest = req
      window.clearTimeout(timer)
      const key = shadeKey(req)
      const hit = cache.get(key)
      if (hit) {
        emit({ status: 'ready', key, shade: hit })
        return
      }
      emit({ status: 'computing', key })
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
