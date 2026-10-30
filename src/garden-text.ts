import { explain, INDOOR_TEMP, type PlantResult, type Rating } from './garden'
import type { PickedKind } from './garden-pick'
import { fmtMonth, fmtNumber, t, upFirst, type Key } from './i18n'
import { plantName, type PlantKind } from './plants'
import type { Climate } from './weather'

// The words and figures of the Garden spot card, kept apart from the DOM so they can be tested.

/** A month on its own (a heading, an option, a chart label): "June" / "Giugno". Inside a sentence use `fmtMonth`. */
export const monthLabel = (month: number): string => upFirst(fmtMonth(month))

export const WHERE: Record<PickedKind, string> = {
  indoor: t('garden.whereIndoor'),
  ground: t('garden.whereGround'),
  roof: t('garden.whereRoof'),
}

/** Where the spot is: a roof spot says whether it is on the picked building or on a neighbour. */
export const whereText = (kind: PickedKind, neighbourRoof = false): string => (kind === 'roof' && neighbourRoof ? t('garden.whereNeighbour') : WHERE[kind])

/** The quiet line under an indoor spot: the temperature the ratings assume. */
export const INDOOR_NOTE = t('garden.indoorNote', { min: INDOOR_TEMP.min, max: INDOOR_TEMP.max })

export const NO_SPOT_HINT = t('garden.noSpot')

export const hoursText = (minutes: number): string => {
  const h = minutes / 60
  return h < 1 ? t('garden.minutes', { n: Math.round(minutes) }) : t('garden.hours', { n: +h.toFixed(1) })
}

export interface StripCell {
  /** One letter for the axis, and the full sentence for the tooltip and screen readers. */
  letter: string
  text: string
  /** 0..1 against the strip's tallest bar. */
  share: number
}

/** Twelve bars of mean daily direct-sun hours (the tallest fills the strip, but a strip under one hour is not stretched). */
export function sunStrip(sunMinutes: number[]): StripCell[] {
  const top = Math.max(60, ...sunMinutes)
  return sunMinutes.map((m, i) => ({
    letter: monthLabel(i)[0],
    text: t('garden.sunCell', { month: monthLabel(i), hours: hoursText(m) }),
    share: m / top,
  }))
}

export interface TempCell {
  letter: string
  text: string
  /** Where the typical low and high fall on the strip, 0 = coldest low of the year, 1 = warmest high. */
  lowShare: number
  highShare: number
  /** The typical night is near or below freezing: the bar is tinted cool. */
  cold: boolean
}

/** Typical lows at or under this count as "near freezing" (degC). */
export const NEAR_FREEZING = 1

/** Twelve floating bars from the typical daily low to the typical daily high, and the year's extremes for the caption. */
export function tempStrip(climate: Pick<Climate, 'tMin' | 'tMax'>): { cells: TempCell[]; min: number; max: number; zeroShare: number | null } {
  const min = Math.min(...climate.tMin)
  const max = Math.max(...climate.tMax)
  const span = Math.max(1, max - min)
  const at = (t: number) => (t - min) / span
  const deg = (v: number) => `${fmtNumber(Math.round(v))} °C`
  return {
    min,
    max,
    zeroShare: min < 0 && max > 0 ? at(0) : null,
    cells: Array.from({ length: 12 }, (_, i) => ({
      letter: monthLabel(i)[0],
      text: t('garden.tempCell', { month: monthLabel(i), lo: deg(climate.tMin[i]), hi: deg(climate.tMax[i]) }),
      lowShare: at(climate.tMin[i]),
      highShare: at(climate.tMax[i]),
      cold: climate.tMin[i] <= NEAR_FREEZING,
    })),
  }
}

/** "all year", the no-month text, or runs of months such as "Mar to Oct" (wrapping the year: "Nov to Mar"). */
export function monthsText(months: boolean[]): string {
  if (months.every(Boolean)) return t('garden.allYear')
  if (!months.some(Boolean)) return NO_MONTH
  const runs: string[] = []
  for (let s = 0; s < 12; s++) {
    if (!months[s] || months[(s + 11) % 12]) continue
    let n = 1
    while (months[(s + n) % 12]) n++
    const end = (s + n - 1) % 12
    const [a, b] = [fmtMonth(s, 'short'), fmtMonth(end, 'short')]
    runs.push(n === 1 ? a : t(n === 2 ? 'garden.runAnd' : 'garden.runTo', { a, b }))
  }
  return runs.join(', ')
}

/** What `monthsText` says for a plant that grows in no month. */
const NO_MONTH = t('garden.noMonth')

export const RATING_LABEL: Record<Rating, string> = { good: t('garden.rateGood'), ok: t('garden.rateOk'), poor: t('garden.ratePoor') }

const KIND_LABEL: Record<PlantKind, Key> = {
  vegetable: 'garden.kindVegetable',
  fruit: 'garden.kindFruit',
  herb: 'garden.kindHerb',
  flower: 'garden.kindFlower',
  houseplant: 'garden.kindHouseplant',
}

const ORDER: Record<Rating, number> = { poor: 0, ok: 1, good: 2 }

/**
 * The month that stands for a plant's all-year verdict. A plant that is good somewhere is described by its best month
 * ("Good in June: ..."), one that is only OK by its hardest month among those it grows in (what holds it back), and a
 * poor one by its hardest month of all (why it fails). Months it cannot grow in do not speak for a plant that grows.
 */
export function representativeMonth(result: PlantResult): number {
  const { year, summary, rating } = result
  const growing = year.map((_, i) => i).filter((i) => summary.months[i])
  const pool = rating === 'poor' || growing.length === 0 ? year.map((_, i) => i) : growing
  const pick = (better: (a: number, b: number) => boolean) => pool.reduce((best, i) => (better(i, best) ? i : best), pool[0])
  const rank = (i: number) => ORDER[year[i].rating]
  if (rating === 'good') return pick((i, best) => rank(i) > rank(best) || (rank(i) === rank(best) && year[i].sunHours > year[best].sunHours))
  return pick((i, best) => rank(i) < rank(best) || (rank(i) === rank(best) && year[i].sunHours < year[best].sunHours))
}

/** One plain sentence for a plant at this spot: the chosen month's, or for the whole year that of its representative month (or the short season). */
export function reasonText(result: PlantResult, month: number | null): string {
  const { plant, summary, year } = result
  if (month !== null) return explain(plant, year[month])
  if (plant.life === 'annual' && summary.fits === false && summary.runMonths > 0 && plant.days !== undefined) {
    const n = summary.runMonths
    return t('garden.tooShort', { n, name: plantName(plant), days: plant.days })
  }
  return explain(plant, year[representativeMonth(result)])
}

export interface PlantRow {
  name: string
  kind: string
  rating: Rating
  /** "Grows all year", "Grows Mar to Oct" ... and, for annual crops that fit, " · Sow in April". */
  growing: string
  reason: string
}

export function plantRow(result: PlantResult, month: number | null): PlantRow {
  const { plant, summary } = result
  const sow = plant.life === 'annual' && summary.sowMonth !== undefined ? t('garden.sow', { month: fmtMonth(summary.sowMonth) }) : ''
  const months = monthsText(summary.months)
  const growing = months === NO_MONTH ? t('garden.growsNowhere') : `${t('garden.grows', { months })}${sow}`
  return { name: upFirst(plantName(plant)), kind: t(KIND_LABEL[plant.kind]), rating: result.rating, growing, reason: reasonText(result, month) }
}

/** Ranked results split for the card: the ones worth growing, and the poor ones kept behind "Why not others?". */
export function splitPlants(ranked: PlantResult[]): { fit: PlantResult[]; poor: PlantResult[] } {
  return { fit: ranked.filter((r) => r.rating !== 'poor'), poor: ranked.filter((r) => r.rating === 'poor') }
}

/** The spot card's list: the best few plants shown, the others kept behind "Show all". */
export function topPlants(fit: PlantResult[], n = 3): { shown: PlantResult[]; rest: PlantResult[] } {
  return { shown: fit.slice(0, n), rest: fit.slice(n) }
}

/** A way out of a "no": one short line, and optionally the month the Month control can switch to. */
export interface DeadEnd {
  text: string
  switchMonth?: number
}

/** The ratings of the months a plant is not poor in, in a word: "Good", "OK", or "OK or good" when mixed. */
function ratingWord(result: PlantResult, months: boolean[]): string {
  const ratings = new Set(result.year.filter((_, i) => months[i]).map((r) => r.rating))
  return ratings.has('ok') ? (ratings.has('good') ? t('garden.rateOkOrGood') : RATING_LABEL.ok) : RATING_LABEL.good
}

/**
 * Where a spot card with nothing suitable can go next. `byYear` holds every plant rated over the whole year (any order).
 * When another month suits some plants, name the month with the most and offer to switch to it ("In May, 6 plants do
 * well here."). Otherwise name the closest plant and its months ("Closest: snake plant, OK Mar to Oct."). Undefined when
 * there are no plants.
 */
export function spotDeadEnd(byYear: PlantResult[], month: number | null): DeadEnd | undefined {
  if (byYear.length === 0) return undefined
  // Counted as the card lists them (not poor), so the month it points to shows the same number.
  const fitIn = (m: number) => byYear.filter((r) => r.year[m].rating !== 'poor').length
  const goodIn = (m: number) => byYear.filter((r) => r.year[m].rating === 'good').length
  const months = Array.from({ length: 12 }, (_, m) => m).filter((m) => m !== month && fitIn(m) > 0)
  const closest = [...byYear].sort((a, b) => b.score - a.score || plantName(a.plant).localeCompare(plantName(b.plant)))[0]
  const closestMonths = closest.summary.months
  if (month !== null && months.length > 0) {
    const best = months.reduce((b, m) => (fitIn(m) > fitIn(b) || (fitIn(m) === fitIn(b) && goodIn(m) > goodIn(b)) ? m : b))
    const n = fitIn(best)
    return { text: t('garden.monthPlants', { n, month: fmtMonth(best) }), switchMonth: best }
  }
  if (closestMonths.some(Boolean)) return { text: t('garden.closest', { name: plantName(closest.plant), rating: ratingWord(closest, closestMonths), months: monthsText(closestMonths) }) }
  // Every plant is poor in every month: there is no closest option worth naming, so say so.
  return { text: t('garden.allPoor') }
}
