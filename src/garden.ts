// Which plants suit a spot, month by month. Direct sun at the spot and local temperature are compared with the plant's
// needs; a rating is the worst thing found, and every finding can be said in one plain sentence.

import { fmtMonth, fmtNumber, locale, t, upFirst } from './i18n'
import { PLANTS, plantName, type Plant } from './plants'
import type { Climate } from './weather'

export type Rating = 'good' | 'ok' | 'poor'
export type IssueKind = 'dark' | 'glare' | 'cold' | 'frost' | 'hot' | 'place'

/** Mean daily direct-sun minutes per month (January first) at a spot, indoors (behind a window) or outdoors. */
export interface Spot {
  indoor: boolean
  sunMinutes: number[]
}

export type Temperatures = Pick<Climate, 'tMean' | 'tMin' | 'tMax' | 'tLow'>

/**
 * ASSUMPTION: a heated home sits between 18 and 24 degC all year, so indoor spots ignore the weather. Real homes
 * differ (cold bedrooms, hot south rooms in summer).
 */
export const INDOOR_TEMP = { min: 18, max: 24 }

const INDOOR: Temperatures = {
  tMean: Array(12).fill((INDOOR_TEMP.min + INDOOR_TEMP.max) / 2),
  tMin: Array(12).fill(INDOOR_TEMP.min),
  tMax: Array(12).fill(INDOOR_TEMP.max),
  tLow: Array(12).fill(INDOOR_TEMP.min),
}

/** Plants that die from any frost are judged by the coldest night on record; hardier ones by the typical night. */
export const TENDER_BELOW = -3

const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const SCORE: Record<Rating, number> = { good: 1, ok: 0.5, poor: 0 }

export interface Issue {
  kind: IssueKind
  /** A severe issue makes the month poor; a mild one makes it ok. */
  severe: boolean
}

export interface MonthResult {
  /** 0 = January. */
  month: number
  rating: Rating
  issues: Issue[]
  /** A hardy perennial outdoors that is too cold to grow: it rests, which is not a failure. */
  resting: boolean
  sunHours: number
  /** The temperatures the plant was judged against, degC. */
  tMean: number
  tMax: number
  /** The night temperature used for frost: coldest on record for tender plants, typical for hardy ones. */
  tNight: number
}

/** One month of one plant at one spot. */
export function rateMonth(plant: Plant, spot: Spot, climate: Temperatures, month: number): MonthResult {
  const air = spot.indoor ? INDOOR : climate
  const sunHours = (spot.sunMinutes[month] ?? 0) / 60
  const tMean = air.tMean[month]
  const tMax = air.tMax[month]
  const tNight = plant.temp.survive > TENDER_BELOW ? air.tLow[month] : air.tMin[month]
  const issues: Issue[] = []
  const add = (kind: IssueKind, severe: boolean) => issues.push({ kind, severe })

  if (spot.indoor ? !plant.indoor : !plant.outdoor) add('place', true)
  const frost = tNight < plant.temp.survive
  // A hardy perennial outdoors that is too cold to grow just rests; it needs no sun and is not failing.
  const dormant = !spot.indoor && plant.life === 'perennial' && tMean < plant.temp.min && !frost
  if (!dormant) {
    if (sunHours < plant.sun.min) add('dark', true)
    else if (sunHours < plant.sun.ideal) add('dark', false)
  }
  if (plant.sun.max !== undefined && sunHours > plant.sun.max) add('glare', true)
  if (tMean < plant.temp.min) add('cold', !dormant)
  else if (tMean < plant.temp.optLow) add('cold', false)
  if (frost) add('frost', true)
  if (tMax > plant.temp.max) add('hot', true)
  else if (tMean > plant.temp.optHigh) add('hot', false)

  const rating: Rating = issues.some((i) => i.severe) ? 'poor' : issues.length > 0 ? 'ok' : 'good'
  return { month, rating, issues, resting: dormant, sunHours, tMean, tMax, tNight }
}

export const rateYear = (plant: Plant, spot: Spot, climate: Temperatures): MonthResult[] =>
  Array.from({ length: 12 }, (_, m) => rateMonth(plant, spot, climate, m))

const hours = (h: number): string => (h < 1 ? t('garden.minutes', { n: Math.round(h * 60) }) : t('garden.hours', { n: +h.toFixed(1) }))
const deg = (v: number): string => `${fmtNumber(Math.round(v))} °C`

/** One plain sentence about a month, e.g. "Too dark in December: 40 min of direct sun, basil needs 6 h." */
export function explain(plant: Plant, r: MonthResult): string {
  const name = plantName(plant)
  const Name = upFirst(name)
  const month = fmtMonth(r.month)
  const issue = r.issues.find((i) => i.severe) ?? r.issues[0]
  const sun = hours(r.sunHours)
  const p = { name, Name, month, sun }
  if (!issue) return t('garden.explainGood', { ...p, t: deg(r.tMean) })
  const temp = plant.temp
  const range = { lo: temp.optLow, hi: temp.optHigh }
  switch (issue.kind) {
    case 'place':
      return t(plant.indoor ? 'garden.explainIndoorOnly' : 'garden.explainOutdoorOnly', p)
    case 'dark':
      return issue.severe
        ? t('garden.explainDark', { ...p, need: hours(plant.sun.min) })
        : t('garden.explainDarkMild', { ...p, ideal: hours(plant.sun.ideal) })
    case 'glare':
      return t('garden.explainGlare', { ...p, max: hours(plant.sun.max ?? 0) })
    case 'cold':
      if (!issue.severe && r.tMean < temp.min) return t('garden.explainResting', { ...p, t: deg(r.tMean), min: deg(temp.min) })
      return issue.severe
        ? t('garden.explainCold', { ...p, t: deg(r.tMean), min: deg(temp.min) })
        : t('garden.explainCool', { ...p, t: deg(r.tMean), ...range })
    case 'frost':
      return t('garden.explainFrost', { ...p, night: deg(r.tNight), survive: deg(temp.survive) })
    case 'hot':
      return issue.severe
        ? t('garden.explainHot', { ...p, tmax: deg(r.tMax), max: deg(temp.max) })
        : t('garden.explainWarm', { ...p, t: deg(r.tMean), ...range })
  }
}

export interface PlantSummary {
  /** Per month, January first: true when the rating is not poor. */
  months: boolean[]
  /** Not poor in any month. */
  allYear: boolean
  /** Annual crops: some unbroken run of fitting months is at least as long as the days to harvest. */
  fits?: boolean
  /** Annual crops that fit: the month (0 = January) to sow or plant out. */
  sowMonth?: number
  /** Length of the longest run of fitting months (circular), 12 when all year. */
  runMonths: number
}

/** The longest run of true values, wrapping around the year; `start` is the first month of it. */
function longestRun(flags: boolean[]): { start: number; length: number } {
  if (flags.every(Boolean)) return { start: 0, length: 12 }
  let best = { start: 0, length: 0 }
  for (let s = 0; s < 12; s++) {
    if (!flags[s] || flags[(s + 11) % 12]) continue
    let n = 0
    while (flags[(s + n) % 12]) n++
    if (n > best.length) best = { start: s, length: n }
  }
  return best
}

const runDays = (start: number, length: number): number => Array.from({ length }, (_, i) => DAYS[(start + i) % 12]).reduce((a, b) => a + b, 0)

export function summarise(plant: Plant, year: MonthResult[]): PlantSummary {
  const months = year.map((r) => r.rating !== 'poor')
  const allYear = months.every(Boolean)
  const run = longestRun(months)
  const summary: PlantSummary = { months, allYear, runMonths: run.length }
  if (plant.life === 'annual' && plant.days !== undefined) {
    summary.fits = run.length > 0 && runDays(run.start, run.length) >= plant.days
    if (summary.fits) {
      const firstGood = year.find((r) => r.rating === 'good')
      summary.sowMonth = allYear ? (firstGood?.month ?? 0) : run.start
    }
  }
  return summary
}

export interface PlantResult {
  plant: Plant
  year: MonthResult[]
  summary: PlantSummary
  /** 0..1 and its rating, for the chosen month or, without one, for the season (see `seasonScore`). */
  score: number
  rating: Rating
}

export const ratingOf = (score: number): Rating => (score >= 0.75 ? 'good' : score >= 0.4 ? 'ok' : 'poor')

/**
 * One number for a plant at a spot: good 1, ok 0.5, poor 0 for the chosen month. Without a month, an annual crop is
 * scored over the months of its best run (0 when the run is too short to reach harvest). A perennial is scored over
 * its months that are not resting: 0 when any month kills it (frost, wrong place). A poor month counts 0.5 instead of 0
 * when the spot gets the plant's minimum sun in its sunniest month: the plant lives there and only grows little in
 * the dull or hot months.
 */
export function seasonScore(plant: Plant, year: MonthResult[], summary: PlantSummary, month?: number): number {
  if (month !== undefined) return SCORE[year[month].rating]
  const mean = (rs: MonthResult[]) => rs.reduce((a, r) => a + SCORE[r.rating], 0) / rs.length
  if (plant.life === 'perennial') {
    if (year.some((r) => r.issues.some((i) => i.severe && (i.kind === 'frost' || i.kind === 'place')))) return 0
    const active = year.filter((r) => !r.resting)
    const lives = Math.max(...year.map((r) => r.sunHours)) >= plant.sun.min
    return active.length === 0 ? 0 : active.reduce((a, r) => a + (r.rating === 'poor' && lives ? 0.5 : SCORE[r.rating]), 0) / active.length
  }
  if (summary.fits === undefined) return mean(year)
  if (!summary.fits) return 0
  const start = summary.sowMonth ?? 0
  const length = summary.allYear ? 12 : summary.runMonths
  return mean(Array.from({ length }, (_, i) => year[(start + i) % 12]))
}

export function assess(plant: Plant, spot: Spot, climate: Temperatures, month?: number): PlantResult {
  const year = rateYear(plant, spot, climate)
  const summary = summarise(plant, year)
  const score = seasonScore(plant, year, summary, month)
  return { plant, year, summary, score, rating: ratingOf(score) }
}

/**
 * Plants for a spot, best first. With `month` (0 = January) they are scored for that month; without, for their season.
 * `allYear` keeps only the plants that are not poor in any month. Poor plants are included, so callers can show why.
 */
export function rankPlants(
  spot: Spot,
  climate: Temperatures,
  options: { month?: number; allYear?: boolean; plants?: Plant[] } = {},
): PlantResult[] {
  return (options.plants ?? PLANTS)
    .map((p) => assess(p, spot, climate, options.month))
    .filter((r) => !options.allYear || r.summary.allYear)
    .sort((a, b) => b.score - a.score || plantName(a.plant).localeCompare(plantName(b.plant), locale()))
}

const ISSUE_ORDER: IssueKind[] = ['dark', 'frost', 'cold', 'hot', 'glare', 'place']

/**
 * What mostly holds a plant back at a spot: the severe issue of the chosen month, or without a month the severe issue
 * found in most months (the first of `dark, frost, cold, hot, glare, place` on a tie). Undefined when nothing severe.
 */
export function mainIssue(result: PlantResult, month?: number): IssueKind | undefined {
  const months = month === undefined ? result.year : [result.year[month]]
  const counts = new Map<IssueKind, number>()
  for (const r of months) for (const i of r.issues) if (i.severe) counts.set(i.kind, (counts.get(i.kind) ?? 0) + 1)
  return ISSUE_ORDER.filter((k) => counts.has(k)).sort((a, b) => counts.get(b)! - counts.get(a)!)[0]
}

/** The reverse: one plant over many spots (same order as `spots`), so a map can be coloured. `why` is set for poor spots. */
export function scoreSpots(plant: Plant, spots: Spot[], climate: Temperatures, month?: number): { score: number; rating: Rating; why?: IssueKind }[] {
  return spots.map((s) => {
    const result = assess(plant, s, climate, month)
    return { score: result.score, rating: result.rating, why: result.rating === 'poor' ? mainIssue(result, month) : undefined }
  })
}
