import { parseHeights, type HeightOverride, type HeightOverrides } from './heights'

/** The user's height changes, kept by OSM polygon id so they follow the building into every scene that has it. */
export const HEIGHTS_KEY = 'sunpatch.heights'
/** The user's answer to "keep them 30 days?": 'keep' (localStorage) or 'session' (sessionStorage). */
export const KEEP_KEY = 'sunpatch.heightsKeep'
export const KEEP_DAYS = 30
export const TTL_MS = KEEP_DAYS * 24 * 60 * 60 * 1000

export type KeepMode = 'keep' | 'session'

interface Entry {
  o: HeightOverride
  /** When the height was last edited (ms since epoch). Using an override does not refresh it. */
  t: number
}
type Layer = Record<string, Entry>

export interface HeightStore {
  /** The answer given to the question, or undefined while it has not been asked. */
  mode(): KeepMode | undefined
  /** Records the answer and moves what is stored to the matching place (session-only data leaves localStorage). */
  setMode(mode: KeepMode): void
  /** Every unexpired override (expired ones are dropped from storage as a side effect). */
  load(): HeightOverrides
  count(): number
  /** Saves (or, with null, forgets) one override, stamped now; it goes where the user's answer says (the session until asked). */
  set(id: string, override: HeightOverride | null): void
  /** Saves several overrides, replacing the stored ones: a shared copy the user chose to keep. */
  put(overrides: HeightOverrides | undefined): void
  /**
   * Imports the heights an older plan carried: only ids the store does not know yet (anything in the store was edited
   * later, since plans had no timestamp), stamped now, into localStorage because they were already on this device.
   */
  migrate(planHeights: HeightOverrides | undefined): void
  clear(): void
}

export interface StoreOptions {
  local?: Storage
  session?: Storage
  now?: () => number
}

function defaultStorage(kind: 'localStorage' | 'sessionStorage'): Storage | undefined {
  try {
    return window[kind]
  } catch {
    return undefined
  }
}

export function createHeightStore(opts: StoreOptions = {}): HeightStore {
  const local = 'local' in opts ? opts.local : defaultStorage('localStorage')
  const session = 'session' in opts ? opts.session : defaultStorage('sessionStorage')
  const now = opts.now ?? Date.now

  function write(storage: Storage | undefined, layer: Layer) {
    if (!storage) return
    try {
      if (Object.keys(layer).length) storage.setItem(HEIGHTS_KEY, JSON.stringify({ v: 1, items: layer }))
      else storage.removeItem(HEIGHTS_KEY)
    } catch {
      // storage full or blocked: the change just is not remembered
    }
  }
  function read(storage: Storage | undefined): Layer {
    if (!storage) return {}
    let parsed: unknown
    try {
      const raw = storage.getItem(HEIGHTS_KEY)
      if (!raw) return {}
      parsed = JSON.parse(raw)
    } catch {
      return {}
    }
    const items = (parsed as { items?: unknown } | null)?.items
    if (typeof items !== 'object' || items === null) return {}
    const at = now()
    const out: Layer = {}
    for (const [id, e] of Object.entries(items as Record<string, Partial<Entry>>)) {
      if (typeof e?.t !== 'number' || !Number.isFinite(e.t) || at - e.t >= TTL_MS) continue
      const o = parseHeights({ [id]: e.o })?.[id]
      if (o) out[id] = { o, t: Math.min(e.t, at) }
    }
    if (Object.keys(out).length !== Object.keys(items).length) write(storage, out) // prune on load
    return out
  }
  const mode = (): KeepMode | undefined => {
    try {
      const v = local?.getItem(KEEP_KEY)
      return v === 'keep' || v === 'session' ? v : undefined
    } catch {
      return undefined
    }
  }
  const newest = (a: Layer, b: Layer): Layer => {
    const out: Layer = { ...a }
    for (const [id, e] of Object.entries(b)) if (!out[id] || out[id].t < e.t) out[id] = e
    return out
  }
  const merged = () => newest(read(local), read(session))
  /** Where new edits go: localStorage only after the user said "keep". */
  const toLocal = () => mode() === 'keep'

  const store: HeightStore = {
    mode,
    setMode(next) {
      try {
        local?.setItem(KEEP_KEY, next)
      } catch {
        // not remembered; the choice still applies below
      }
      const all = merged()
      write(next === 'keep' ? local : session, all)
      write(next === 'keep' ? session : local, {})
    },
    load: () => Object.fromEntries(Object.entries(merged()).map(([id, e]) => [id, e.o])),
    count: () => Object.keys(merged()).length,
    set(id, override) {
      const l = read(local)
      const s = read(session)
      delete l[id]
      delete s[id]
      if (override) (toLocal() ? l : s)[id] = { o: override, t: now() }
      write(local, l)
      write(session, s)
    },
    put(overrides) {
      for (const [id, o] of Object.entries(overrides ?? {})) store.set(id, o)
    },
    migrate(planHeights) {
      const known = merged()
      const l = read(local)
      let changed = false
      for (const [id, o] of Object.entries(planHeights ?? {})) {
        if (known[id]) continue
        l[id] = { o, t: now() }
        changed = true
      }
      if (changed) write(local, l)
    },
    clear() {
      write(local, {})
      write(session, {})
    },
  }
  return store
}

/**
 * The overrides a scene starts with. A shared copy shows its own heights over the stored ones and writes nothing; the
 * viewer's own plan hands over its older heights to the store (`migrate`) and the store is then the truth.
 */
export function resolveHeights(store: HeightStore, planHeights: HeightOverrides | undefined, shared: boolean): HeightOverrides {
  if (shared) return { ...store.load(), ...planHeights }
  store.migrate(planHeights)
  return store.load()
}
