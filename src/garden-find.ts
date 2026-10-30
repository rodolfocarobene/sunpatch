import { POT_HEIGHT, type GardenSpot, type SpotKind, type SunnySpot } from './garden-spots'
import { assess, type IssueKind, type Rating, type Temperatures } from './garden'
import type { Plant } from './plants'
import { MONTH_NAMES, hoursText, monthsText, type DeadEnd } from './garden-text'

// "Find a place for ...": one plant scored over every spot of the garden analysis. The words, the three colour steps and
// the kind filtering live here, apart from the DOM and the scene, so they can be tested.

export type FindKind = Exclude<SpotKind, 'point'>
export const FIND_KINDS: FindKind[] = ['indoor', 'ground', 'roof']

/** Colour step of a spot on the plant map: 2 good, 1 ok, 0 poor (left uncoloured so the map stays readable). */
export type Step = 0 | 1 | 2
export const stepOf = (rating: Rating): Step => (rating === 'good' ? 2 : rating === 'ok' ? 1 : 0)

/** The two coloured steps read from the --rate-good / --rate-ok tokens in style.css, so the pills, legend and map share one scale. */
export const stepColor = (step: 1 | 2): string => getComputedStyle(document.documentElement).getPropertyValue(step === 2 ? '--rate-good' : '--rate-ok').trim()
/** An OK cell is drawn at this share of a good cell's side: a size cue that does not rely on colour. */
export const OK_CELL_SCALE = 0.62
export const STEP_LABELS: Record<Step, string> = { 2: 'Good', 1: 'OK', 0: 'Poor' }

/** Side of a spot's square on the map, metres (the sampling cell of its kind). */
export const CELL_SIZE: Record<FindKind, number> = { indoor: 0.5, ground: 2, roof: 1 }

export interface Kinds {
  kinds: FindKind[]
  /** One line on why some spots are skipped; absent when the plant can stand anywhere. */
  note?: string
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

/** The spot kinds a plant can be judged on: indoor-only plants skip outdoor spots, outdoor-only plants skip the floor. */
export function kindsFor(plant: Plant): Kinds {
  if (plant.indoor && !plant.outdoor) return { kinds: ['indoor'], note: `${cap(plant.name)} is grown indoors, so ground and roof spots are not scored.` }
  if (plant.outdoor && !plant.indoor) return { kinds: ['ground', 'roof'], note: `${cap(plant.name)} is grown outdoors, so indoor spots are not scored.` }
  return { kinds: [...FIND_KINDS] }
}

export interface Scored {
  score: number
  rating: Rating
  /** For a poor spot: what mostly holds the plant back there. */
  why?: IssueKind
}

export interface KindStats {
  kind: FindKind
  total: number
  good: number
  ok: number
  /** Where the good spots are on average (the ok ones when none is good), scene metres; absent without any. */
  centre?: { x: number; z: number }
  /** The rating level the centre was taken over. */
  centreOf?: 'good' | 'ok'
  /** When no spot of this kind is even OK: the one reason most of them share, if there is a clear one. */
  why?: IssueKind
}

/** At least this share of a kind's spots must fail for the same reason before the summary names it. */
export const CLEAR_REASON = 0.6

/** Counts per kind for the scored spots (an entry of `scored` is undefined when that spot was not scored). */
export function kindStats(spots: GardenSpot[], scored: (Scored | undefined)[]): KindStats[] {
  const out: KindStats[] = []
  for (const kind of FIND_KINDS) {
    const idx = spots.map((s, i) => (s.kind === kind && scored[i] ? i : -1)).filter((i) => i >= 0)
    if (idx.length === 0) continue
    const of = (rating: Rating) => idx.filter((i) => scored[i]!.rating === rating)
    const good = of('good')
    const ok = of('ok')
    const lead = good.length > 0 ? good : ok
    const stat: KindStats = { kind, total: idx.length, good: good.length, ok: ok.length }
    if (lead.length > 0) {
      stat.centre = { x: lead.reduce((a, i) => a + spots[i].x, 0) / lead.length, z: lead.reduce((a, i) => a + spots[i].z, 0) / lead.length }
      stat.centreOf = good.length > 0 ? 'good' : 'ok'
    }
    if (good.length === 0 && ok.length === 0) {
      const counts = new Map<IssueKind, number>()
      for (const i of idx) if (scored[i]!.why) counts.set(scored[i]!.why!, (counts.get(scored[i]!.why!) ?? 0) + 1)
      const [top, n] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? []
      if (top && n / idx.length >= CLEAR_REASON) stat.why = top
    }
    out.push(stat)
  }
  return out
}

const WINDS = ['east', 'north-east', 'north', 'north-west', 'west', 'south-west', 'south', 'south-east']

/** Compass word for an offset in scene metres (x east, z south): "south", "north-east"; empty when it is within `near` metres. */
export function compass(dx: number, dz: number, near: number): string {
  if (Math.hypot(dx, dz) < near) return ''
  return WINDS[(Math.round(Math.atan2(-dz, dx) / (Math.PI / 4)) + 8) % 8]
}

/** The place words for the good (or ok) spots of one kind, relative to the building's centre. */
function place(stat: KindStats, centre: { x: number; z: number }): string {
  const dir = stat.centre ? compass(stat.centre.x - centre.x, stat.centre.z - centre.z, stat.kind === 'ground' ? 4 : 2) : ''
  if (stat.kind === 'roof') return 'the roof'
  if (stat.kind === 'ground') return dir ? `the ground ${dir} of the building` : 'the ground around the building'
  return dir ? `indoors, in the ${dir} of the apartment` : 'indoors'
}

const NOWHERE: Record<FindKind, string> = { indoor: 'indoors', ground: 'on the ground', roof: 'on the roof' }

/** Why spots fail, in the words of "Nowhere suitable indoors (not enough direct sun)". Plain "place" has no reason to give. */
const WHY: Partial<Record<IssueKind, string>> = {
  dark: 'not enough direct sun',
  glare: 'too much direct sun',
  cold: 'too cold',
  frost: 'frost',
  hot: 'too hot',
}

const list = (items: string[]): string => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`)

/**
 * Two plain sentences: where the plant grows best (good spots first, ok ones when none is good), and where it finds nowhere.
 * `centre` is the building's centre in scene metres, so spots can be named by direction.
 */
export function findSummary(plantName: string, month: string | null, stats: KindStats[], centre: { x: number; z: number }): string {
  const when = month === null ? '' : ` in ${month}`
  if (stats.length === 0) return ''
  const withGood = stats.filter((s) => s.good > 0)
  const withOk = stats.filter((s) => s.good === 0 && s.ok > 0)
  const none = stats.filter((s) => s.good === 0 && s.ok === 0)
  const parts: string[] = []
  if (withGood.length > 0) {
    parts.push(`Best spots for ${plantName}${when}: ${list(withGood.map((s) => place(s, centre)))}.`)
    if (withOk.length > 0) parts.push(`Only fair: ${list(withOk.map((s) => place(s, centre)))}.`)
  } else if (withOk.length > 0) {
    parts.push(`No spot is ideal for ${plantName}${when}; the best are ${list(withOk.map((s) => place(s, centre)))}.`)
  } else {
    parts.push(`${cap(plantName)} finds no suitable spot${when}.`)
    return parts.join(' ')
  }
  // A kind with a clear reason gets its own sentence, so the reason cannot be read as belonging to the others.
  const why = (s: KindStats) => (s.why ? WHY[s.why] : undefined)
  const plain = none.filter((s) => !why(s))
  if (plain.length > 0) parts.push(`Nowhere suitable ${list(plain.map((s) => NOWHERE[s.kind]))}.`)
  for (const s of none.filter(why)) parts.push(`Nowhere suitable ${NOWHERE[s.kind]} (${why(s)}).`)
  return parts.join(' ')
}

/**
 * The spot to show first: the highest score, then the most direct sun in the chosen month (or over the year), so that among
 * equally good spots the sunniest wins. Undefined when nothing was scored or nothing is better than poor.
 */
export function bestSpot(spots: SunnySpot[], scored: (Scored | undefined)[], month: number | null): number | undefined {
  const sun = (s: SunnySpot) => (month === null ? s.sunMinutes.reduce((a, b) => a + b, 0) / 12 : s.sunMinutes[month])
  let best: number | undefined
  spots.forEach((s, i) => {
    const r = scored[i]
    if (!r || r.rating === 'poor') return
    if (best === undefined) return void (best = i)
    const b = scored[best]!
    if (r.score > b.score || (r.score === b.score && sun(s) > sun(spots[best]))) best = i
  })
  return best
}

/** The surface height under a spot (spots stand `POT_HEIGHT` above it): what a click on that surface would report. */
export const surfaceY = (spot: GardenSpot): number => spot.y - POT_HEIGHT

/** Per month, how many of the spots are good for a plant and how many only OK. */
export interface MonthCount {
  good: number
  ok: number
}

/** The plant over the given spots in each month (each spot is rated once; a month's rating is read from its year). */
export function monthCounts(plant: Plant, spots: SunnySpot[], climate: Temperatures): MonthCount[] {
  const counts: MonthCount[] = Array.from({ length: 12 }, () => ({ good: 0, ok: 0 }))
  for (const s of spots) {
    assess(plant, s, climate).year.forEach((r, m) => {
      if (r.rating === 'good') counts[m].good++
      else if (r.rating === 'ok') counts[m].ok++
    })
  }
  return counts
}

/**
 * The way out of "finds no suitable spot": the months the plant does find one (and the month with most good spots, to
 * switch to), or, when no month works anywhere, the sunniest any spot gets against what the plant needs (or the
 * reason most spots share). Undefined when the data holds no other month to point to.
 */
export function findDeadEnd(plant: Plant, month: number | null, counts: MonthCount[], spots: SunnySpot[], why?: IssueKind): DeadEnd | undefined {
  const name = cap(plant.name)
  const working = counts.map((c) => c.good + c.ok > 0)
  const withGood = counts.map((c) => c.good > 0)
  if (working.some(Boolean)) {
    const usable = withGood.some(Boolean) ? withGood : working
    const others = usable.map((u, m) => u && m !== month)
    if (!others.some(Boolean)) return undefined
    const better = (a: number, b: number) => counts[a].good > counts[b].good || (counts[a].good === counts[b].good && counts[a].ok > counts[b].ok)
    const best = others.map((o, m) => (o ? m : -1)).filter((m) => m >= 0).reduce((b, m) => (better(m, b) ? m : b))
    return { text: `${name} ${withGood.some(Boolean) ? 'does well' : 'is only fair'} here in ${monthsText(others)}.`, switchMonth: best }
  }
  if (spots.length === 0) return undefined
  let sunMax = 0
  let sunMonth = 0
  for (const s of spots) s.sunMinutes.forEach((m, i) => { if (m > sunMax) { sunMax = m; sunMonth = i } })
  if (why === 'dark' || (why === undefined && sunMax / 60 < plant.sun.min)) {
    return { text: `Nowhere suitable all year; the sunniest spot gets ${hoursText(sunMax)} in ${MONTH_NAMES[sunMonth]}, ${plant.name} needs ${hoursText(plant.sun.min * 60)}.` }
  }
  const reason = why ? WHY[why] : undefined
  return { text: reason ? `Nowhere suitable all year (${reason}).` : 'Nowhere suitable in any month.' }
}
