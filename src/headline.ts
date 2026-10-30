import { dayLabel, STEP } from './daylight'
import { fmtTime, t } from './i18n'
import { duration, litIntervals, type Interval, type SunMapResult } from './sunmap'

// The headline answer of the 3D tab: when the sun reaches the apartment floor on the chosen date, in one sentence.
// It reads the sun map's lit flags (any floor sample lit in a slot), so no second trace is needed.

/** Runs of lit slots closer than this are listed as one stretch (a chimney or a branch passing a window). */
const MERGE_GAP = 2 * STEP
/** At most this many stretches are written out. */
const MAX_RANGES = 2

export interface DayHeadline {
  /** Minutes of the day with direct sun on at least one spot of the floor. */
  minutes: number
  /** Stretches to show (at most two, in clock order; the longest when there are more). */
  shown: Interval[]
  /** True when there were more stretches than are shown. */
  more: boolean
  /** Start of the slot in which the most floor is lit (middle of a tie), minutes of the day. */
  peak: number | undefined
}

/** Turns per-sample, per-slot lit flags into the day's stretches of sun. */
export function dayHeadline(result: Pick<SunMapResult, 'lit' | 'starts'> & { grid: { count: number } }): DayHeadline {
  const n = result.starts.length
  const counts = new Uint32Array(n)
  for (let s = 0; s < result.grid.count; s++) {
    for (let i = 0; i < n; i++) counts[i] += result.lit[s * n + i]
  }
  const any = Array.from(counts, (c) => (c > 0 ? 1 : 0))
  const minutes = any.reduce<number>((sum, a) => sum + a, 0) * STEP
  const runs: Interval[] = []
  for (const run of litIntervals(any, result.starts)) {
    const last = runs[runs.length - 1]
    if (last && run.from - last.to <= MERGE_GAP) last.to = run.to
    else runs.push({ ...run })
  }
  const top = runs.length > MAX_RANGES ? [...runs].sort((a, b) => b.to - b.from - (a.to - a.from)).slice(0, MAX_RANGES).sort((a, b) => a.from - b.from) : runs
  let max = 0
  for (const c of counts) max = Math.max(max, c)
  const best = max > 0 ? result.starts.filter((_, i) => counts[i] === max) : []
  return { minutes, shown: top, more: runs.length > top.length, peak: best.length ? best[Math.floor(best.length / 2)] : undefined }
}

/** Wall-clock text of a minute of the day, through the locale's time format. */
export const timeText = (minutes: number) => fmtTime(new Date(2001, 0, 1, 0, Math.round(minutes)))

export const rangeText = (r: Interval) => `${timeText(r.from)}\u2013${timeText(r.to)}`

/** The sentence and its quiet detail for a day: "Sun inside on 21 Dec: 10:40–14:20 · 3 h 40 min". */
export function headlineText(h: DayHeadline, day: Date): { text: string; detail: string } {
  const label = dayLabel(day.getMonth(), day.getDate())
  if (h.minutes === 0) return { text: t('sun.headNone', { day: label }), detail: t('sun.headNoneHint') }
  const ranges = h.shown.map(rangeText).join(', ') + (h.more ? ', \u2026' : '')
  return {
    text: t('sun.headSun', { day: label, ranges, duration: duration(h.minutes) }),
    detail: h.peak === undefined ? '' : t('sun.headPeak', { time: timeText(h.peak) }),
  }
}
