import { fmtMonth, t } from './i18n'
import { duration } from './sunmap'

// "Through the year": direct sun inside on one day of each month, as a 12-bar chart. This is the pure part
// (the days, the bar heights and the one-line summary); year-job.ts traces them and year-card.ts draws them.

/** The day of each month that stands for it: the 21st, the day of the solstices, so December and June match the presets. */
export const YEAR_DAY = 21

/** The 12 days (local midnight) the chart traces, January to December. */
export const yearDays = (year: number): Date[] => Array.from({ length: 12 }, (_, m) => new Date(year, m, YEAR_DAY))

/** Bar heights as fractions of the largest value (0 when nothing has sun, so no bar is invented). */
export function barFractions(minutes: number[]): number[] {
  const max = Math.max(0, ...minutes)
  return minutes.map((m) => (max > 0 ? m / max : 0))
}

/** Index of the month with the most (`most`) or the least minutes; the first on a tie. */
export function extremeMonth(minutes: number[], most: boolean): number {
  let best = 0
  minutes.forEach((m, i) => {
    if (most ? m > minutes[best] : m < minutes[best]) best = i
  })
  return best
}

/** Runs of consecutive months (wrapping from December to January) where `has` is true, as [first, last] month indexes. */
export function monthRuns(has: boolean[]): [number, number][] {
  const n = has.length
  if (has.every(Boolean)) return [[0, n - 1]]
  // Start just after a month that is false, so a run across the new year stays in one piece.
  const start = has.findIndex((h) => !h)
  const runs: [number, number][] = []
  let first = -1
  for (let k = 1; k <= n; k++) {
    const i = (start + k) % n
    if (has[i] && first < 0) first = i
    if (first >= 0 && (!has[i] || k === n)) {
      runs.push([first, has[i] ? i : (i + n - 1) % n])
      first = -1
    }
  }
  return runs.sort((a, b) => a[0] - b[0])
}

const monthName = (m: number) => fmtMonth(m)
/** A duration that does not break across lines inside the sentence. */
const dur = (minutes: number) => duration(minutes).replace(/ /g, '\u00a0')

/** "No direct sun from November to January": the months without sun, as the sentence's tail. */
function noSunText(minutes: number[]): string {
  const runs = monthRuns(minutes.map((m) => m === 0))
  if (runs.length === 1 && runs[0][1] - runs[0][0] === minutes.length - 1) return t('year.never')
  const parts = runs.map(([a, b]) => (a === b ? t('year.inMonth', { month: monthName(a) }) : t('year.fromTo', { from: monthName(a), to: monthName(b) })))
  return t('year.noSun', { months: parts.join(', ') })
}

/** The line above the bars: "Most sun in June (7 h 10 min), least in December (3 h 15 min)", or which months get none. */
export function yearSummary(minutes: number[]): string {
  const max = extremeMonth(minutes, true)
  const min = extremeMonth(minutes, false)
  if (minutes[max] === 0) return t('year.never')
  const most = t('year.most', { month: monthName(max), duration: dur(minutes[max]) })
  if (minutes[min] === 0) return `${most}. ${noSunText(minutes)}`
  return t('year.mostLeast', { most: monthName(max), mostDuration: dur(minutes[max]), least: monthName(min), leastDuration: dur(minutes[min]) })
}
