// Monthly clear-sky index from NASA POWER climatology: all-sky over clear-sky irradiance on the horizontal.
// One request per place (rounded to 0.1 degrees), kept in memory and in localStorage; it is a 25-year average.

const ENDPOINT = 'https://power.larc.nasa.gov/api/temporal/climatology/point'
const STORAGE_KEY = 'sunpatch.nasaPower.v1'
/** Climatology does not change: a month is plenty. */
export const CACHE_TTL_MS = 30 * 24 * 3600 * 1000
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

export interface Climate {
  /** Monthly all-sky / clear-sky ratio, January first, 0..1. */
  clearness: number[]
}

/** The place rounded to 0.1 degrees, as the cache key and the request. */
export function climateKey(lat: number, lon: number): { lat: number; lon: number; key: string } {
  const la = Math.round(lat * 10) / 10
  const lo = Math.round(lon * 10) / 10
  return { lat: la, lon: lo, key: `${la.toFixed(1)},${lo.toFixed(1)}` }
}

export const climateUrl = (lat: number, lon: number): string =>
  `${ENDPOINT}?parameters=ALLSKY_SFC_SW_DWN,CLRSKY_SFC_SW_DWN&community=RE&longitude=${lon}&latitude=${lat}&format=JSON`

/** Reads a NASA POWER climatology response; throws when it lacks a usable month. */
export function parseClimate(json: unknown): Climate {
  const param = (json as { properties?: { parameter?: Record<string, Record<string, number>> } })?.properties?.parameter
  const all = param?.ALLSKY_SFC_SW_DWN
  const clear = param?.CLRSKY_SFC_SW_DWN
  if (!all || !clear) throw new Error('NASA POWER response has no irradiance')
  const clearness = MONTHS.map((m) => {
    const a = all[m]
    const c = clear[m]
    if (!(a >= 0) || !(c > 0)) throw new Error('NASA POWER response has a missing month')
    return Math.min(1, a / c)
  })
  return { clearness }
}

const memory = new Map<string, Climate>()
const pending = new Map<string, Promise<Climate>>()

function stored(key: string): Climate | undefined {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, { at: number; climate: Climate }>
    const hit = all[key]
    if (hit && Date.now() - hit.at < CACHE_TTL_MS && hit.climate.clearness?.length === 12) return hit.climate
  } catch {
    // storage unavailable or corrupt: fetch instead
  }
  return undefined
}

function store(key: string, climate: Climate) {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, unknown>
    all[key] = { at: Date.now(), climate }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  } catch {
    // not persisted; the memory cache still serves this session
  }
}

/**
 * The climate of a place: from memory, then localStorage, then one request. Rejects on any failure; the caller shows
 * the ideal figure alone and offers a retry, nothing here retries.
 */
export function loadClimate(lat: number, lon: number, fetcher: typeof fetch = (...a) => fetch(...a)): Promise<Climate> {
  const place = climateKey(lat, lon)
  const cached = memory.get(place.key) ?? stored(place.key)
  if (cached) {
    memory.set(place.key, cached)
    return Promise.resolve(cached)
  }
  const inFlight = pending.get(place.key)
  if (inFlight) return inFlight
  const request = fetcher(climateUrl(place.lat, place.lon))
    .then((r) => {
      if (!r.ok) throw new Error(`NASA POWER answered ${r.status}`)
      return r.json()
    })
    .then((json) => {
      const climate = parseClimate(json)
      memory.set(place.key, climate)
      store(place.key, climate)
      return climate
    })
    .finally(() => pending.delete(place.key))
  pending.set(place.key, request)
  return request
}

/** Forgets the in-memory copies (tests). */
export const clearClimateMemory = (): void => memory.clear()
