import { explain, INDOOR_TEMP, type PlantResult, type Rating } from './garden'
import type { PickedKind } from './garden-pick'
import type { PlantKind } from './plants'
import type { Climate } from './weather'

// The words and figures of the Garden spot card, kept apart from the DOM so they can be tested.

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const SHORT = MONTH_NAMES.map((m) => m.slice(0, 3))

export const WHERE: Record<PickedKind, string> = {
  indoor: 'Indoors, on the floor',
  ground: 'Outdoors, on the ground',
  roof: 'On a roof or terrace',
}

/** The quiet line under an indoor spot: the temperature the ratings assume. */
export const INDOOR_NOTE = `Assumes a heated home, ${INDOOR_TEMP.min}-${INDOOR_TEMP.max} °C.`

export const NO_SPOT_HINT = 'Click the floor, a balcony, the ground or a roof to see what grows there.'

export const hoursText = (minutes: number): string => {
  const h = minutes / 60
  return h < 1 ? `${Math.round(minutes)} min` : `${+h.toFixed(1)} h`
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
    letter: MONTH_NAMES[i][0],
    text: `${MONTH_NAMES[i]}: ${hoursText(m)} of direct sun a day`,
    share: m / top,
  }))
}

export interface TempCell {
  letter: string
  text: string
  /** Where the typical low and high fall on the strip, 0 = coldest low of the year, 1 = warmest high. */
  lowShare: number
  highShare: number
}

/** Twelve floating bars from the typical daily low to the typical daily high, and the year's extremes for the caption. */
export function tempStrip(climate: Pick<Climate, 'tMin' | 'tMax'>): { cells: TempCell[]; min: number; max: number; zeroShare: number | null } {
  const min = Math.min(...climate.tMin)
  const max = Math.max(...climate.tMax)
  const span = Math.max(1, max - min)
  const at = (t: number) => (t - min) / span
  const deg = (t: number) => `${Math.round(t)} °C`
  return {
    min,
    max,
    zeroShare: min < 0 && max > 0 ? at(0) : null,
    cells: MONTH_NAMES.map((name, i) => ({
      letter: name[0],
      text: `${name}: typically ${deg(climate.tMin[i])} at night, ${deg(climate.tMax[i])} by day`,
      lowShare: at(climate.tMin[i]),
      highShare: at(climate.tMax[i]),
    })),
  }
}

/** "all year", "no month", or runs of months such as "Mar to Oct" (wrapping the year: "Nov to Mar"). */
export function monthsText(months: boolean[]): string {
  if (months.every(Boolean)) return 'all year'
  if (!months.some(Boolean)) return 'no month'
  const runs: string[] = []
  for (let s = 0; s < 12; s++) {
    if (!months[s] || months[(s + 11) % 12]) continue
    let n = 1
    while (months[(s + n) % 12]) n++
    const end = (s + n - 1) % 12
    runs.push(n === 1 ? SHORT[s] : n === 2 ? `${SHORT[s]} and ${SHORT[end]}` : `${SHORT[s]} to ${SHORT[end]}`)
  }
  return runs.join(', ')
}

export const RATING_LABEL: Record<Rating, string> = { good: 'Good', ok: 'OK', poor: 'Poor' }

const KIND_LABEL: Record<PlantKind, string> = { vegetable: 'vegetable', fruit: 'fruit', herb: 'herb', flower: 'flower', houseplant: 'houseplant' }

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
    return `Too short a season: the good stretch is ${n} ${n === 1 ? 'month' : 'months'}, ${plant.name} needs about ${plant.days} days.`
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

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

export function plantRow(result: PlantResult, month: number | null): PlantRow {
  const { plant, summary } = result
  const sow = plant.life === 'annual' && summary.sowMonth !== undefined ? ` · Sow in ${MONTH_NAMES[summary.sowMonth]}` : ''
  const months = monthsText(summary.months)
  const growing = months === 'no month' ? 'Does not grow here in any month' : `Grows ${months}${sow}`
  return { name: cap(plant.name), kind: KIND_LABEL[plant.kind], rating: result.rating, growing, reason: reasonText(result, month) }
}

/** Ranked results split for the card: the ones worth growing, and the poor ones kept behind "Why not others?". */
export function splitPlants(ranked: PlantResult[]): { fit: PlantResult[]; poor: PlantResult[] } {
  return { fit: ranked.filter((r) => r.rating !== 'poor'), poor: ranked.filter((r) => r.rating === 'poor') }
}
