import SunCalc from 'suncalc'

/** The time slider runs 0..DAY_MAX minutes in steps of STEP. */
export const DAY_MAX = 1435
export const STEP = 5

const RAD = Math.PI / 180
/** Altitude of the sun's centre at sunrise and sunset (refraction and disc size), as in SunCalc. */
const HORIZON = -0.833
const TWILIGHT = -6
const GOLDEN = 6

export type Preset = 'winter' | 'equinox' | 'summer' | 'today'
export interface PresetDate {
  id: Preset
  label: string
  title: string
  /** YYYY-MM-DD in the given year; today's date for 'today'. */
  date: string
}

const pad = (n: number) => String(n).padStart(2, '0')
export const dateValue = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** The one short date format of the app: "21 Dec" (month is 0-11). */
export const dayLabel = (month: number, day: number) => `${day} ${MONTHS[month]}`

/** Solstices and the March equinox in `year`; Winter and Summer swap south of the equator. */
export function presetDates(year: number, lat: number, today: Date): PresetDate[] {
  const south = lat < 0
  const dec = `${year}-12-21`
  const jun = `${year}-06-21`
  return [
    { id: 'winter', label: 'Winter', title: `Winter solstice, ${south ? dayLabel(5, 21) : dayLabel(11, 21)}`, date: south ? jun : dec },
    { id: 'equinox', label: 'Equinox', title: `March equinox, ${dayLabel(2, 20)}`, date: `${year}-03-20` },
    { id: 'summer', label: 'Summer', title: `Summer solstice, ${south ? dayLabel(11, 21) : dayLabel(5, 21)}`, date: south ? dec : jun },
    { id: 'today', label: 'Today', title: 'Today', date: dateValue(today) },
  ]
}

/** The preset that matches a YYYY-MM-DD value, if any. */
export function activePreset(presets: PresetDate[], value: string): Preset | undefined {
  return presets.find((p) => p.date === value)?.id
}

export type Band = 'night' | 'twilight' | 'golden' | 'day'
export interface Segment {
  band: Band
  /** Fractions of the slider track, 0..1. */
  from: number
  to: number
}

export interface Daylight {
  /** Minutes of the local day when the sun is first and last above the horizon, or null when it never is. */
  sunrise: number | null
  sunset: number | null
  /** Minutes at the sun's highest point. */
  noon: number
  /** Sun never sets (polar day) or never rises (polar night) on this date. */
  polar: 'day' | 'night' | null
  segments: Segment[]
}

function bandOf(altitudeDeg: number): Band {
  if (altitudeDeg < TWILIGHT) return 'night'
  if (altitudeDeg < HORIZON) return 'twilight'
  if (altitudeDeg < GOLDEN) return 'golden'
  return 'day'
}

/**
 * Samples the sun every STEP minutes of the local calendar day `y-m-d`.
 * Sampling instead of SunCalc.getTimes keeps polar days and nights, and time zones that
 * put sunrise on another local day, correct.
 */
export function daylight(day: Date, lat: number, lon: number): Daylight {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate())
  const bands: Band[] = []
  let best = -Infinity
  let noon = 720
  let first = -1
  let last = -1
  for (let m = 0; m <= DAY_MAX; m += STEP) {
    const t = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, m)
    const alt = SunCalc.getPosition(t, lat, lon).altitude / RAD
    bands.push(bandOf(alt))
    if (alt > best) {
      best = alt
      noon = m
    }
    if (alt > HORIZON) {
      if (first < 0) first = m
      last = m
    }
  }
  const segments: Segment[] = []
  bands.forEach((band, i) => {
    const prev = segments[segments.length - 1]
    if (prev && prev.band === band) prev.to = Math.min(1, ((i + 1) * STEP) / DAY_MAX)
    else segments.push({ band, from: prev ? prev.to : 0, to: Math.min(1, ((i + 1) * STEP) / DAY_MAX) })
  })
  segments[segments.length - 1].to = 1
  const up = first >= 0
  return {
    sunrise: up ? first : null,
    sunset: up ? last : null,
    noon,
    polar: !up ? 'night' : first === 0 && last === DAY_MAX ? 'day' : null,
    segments,
  }
}

/** Slider minutes to start at: now if the sun is up, else solar noon of that day. */
export function startMinutes(now: Date, lat: number, lon: number): number {
  const current = now.getHours() * 60 + Math.floor(now.getMinutes() / STEP) * STEP
  if (SunCalc.getPosition(now, lat, lon).altitude / RAD > 0) return current
  return daylight(now, lat, lon).noon
}

/**
 * Next minute for Play: one step on inside the daylight window, a wrap to sunrise at its end,
 * and sunrise when the current time is outside it. Without a window (polar night) the whole day plays.
 */
export function nextPlayMinute(current: number, d: Pick<Daylight, 'sunrise' | 'sunset'>): number {
  const rise = d.sunrise === null ? 0 : Math.ceil(d.sunrise / STEP) * STEP
  const set = d.sunset === null ? DAY_MAX : Math.floor(d.sunset / STEP) * STEP
  if (current < rise || current >= set) return rise
  return current + STEP
}

/** CSS linear-gradient for the day strip; colours are var() tokens named --strip-<band>. */
export function stripGradient(segments: Segment[]): string {
  const pct = (f: number) => `${+(f * 100).toFixed(2)}%`
  const stops = segments.map((s) => `var(--strip-${s.band}) ${pct(s.from)} ${pct(s.to)}`)
  return `linear-gradient(to right, ${stops.join(', ')})`
}
