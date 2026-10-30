import { rankPlants, type PlantResult } from './garden'
import type { PickedKind } from './garden-pick'
import {
  INDOOR_NOTE, MONTH_NAMES, NO_SPOT_HINT, RATING_LABEL, WHERE, hoursText, plantRow, splitPlants, sunStrip, tempStrip, type PlantRow,
} from './garden-text'
import { ACCURACY_URL } from './panel-card'
import type { Climate } from './weather'

// The Garden spot card: what the sun and the weather at one clicked spot let grow. It is docked in the left panel of the
// Garden view; main.ts feeds it. It leads with where the spot is, then the months of sun and temperature, then the plants.

export type GardenTrace =
  | { status: 'idle' }
  | { status: 'running'; progress: number }
  | { status: 'done'; sunMinutes: number[] }
  | { status: 'error'; message: string }

export interface GardenCardInput {
  /** Null before a spot is picked. */
  kind: PickedKind | null
  /** A one-line note for a click that made no spot (a facade), shown with the hint. */
  hint?: string
  trace: GardenTrace
  /** The local climate: only outdoor spots need it. */
  weather: 'idle' | 'loading' | 'ready' | 'error'
  climate?: Climate
  /** 0 = January; null = the whole year. */
  month: number | null
}

export interface GardenCard {
  el: HTMLElement
  set(input: GardenCardInput): void
}

const CLOSE_ICON =
  '<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>'
const NS = 'http://www.w3.org/2000/svg'
const W = 252
const SLOT = W / 12
const BAR = 14

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] =>
  Object.assign(document.createElement(tag), { className, textContent: text })

/** Indoor spots ignore the weather; this only satisfies the signature. */
const NO_CLIMATE: Pick<Climate, 'tMean' | 'tMin' | 'tMax' | 'tLow'> = { tMean: Array(12).fill(0), tMin: Array(12).fill(0), tMax: Array(12).fill(0), tLow: Array(12).fill(0) }

export function createGardenCard(options: { onMonth: (month: number | null) => void; onRetryClimate: () => void; onRetryTrace: () => void; onClose: () => void }): GardenCard {
  const root = el('div', 'panelCard gardenCard')
  root.setAttribute('role', 'region')
  root.setAttribute('aria-label', 'What grows at the selected spot')
  const head = el('div', 'gardenHead')
  const close = el('button', 'cardClose')
  close.type = 'button'
  close.title = 'Close (Esc)'
  close.setAttribute('aria-label', 'Close')
  close.innerHTML = CLOSE_ICON
  close.addEventListener('click', options.onClose)
  const body = el('div', 'cardBody')
  // The month filter is made once, so it keeps focus while the plants below it change.
  const filter = el('label', 'monthFilter')
  const select = el('select')
  select.append(Object.assign(document.createElement('option'), { value: '', textContent: 'All year' }))
  MONTH_NAMES.forEach((m, i) => select.append(Object.assign(document.createElement('option'), { value: String(i), textContent: m })))
  select.addEventListener('change', () => options.onMonth(select.value === '' ? null : Number(select.value)))
  filter.append('Plants for ', select)
  const results = el('div', 'gardenResults')
  root.append(head, close, body)
  let poorOpen = false

  const svg = (height: number, label: string): SVGSVGElement => {
    const s = document.createElementNS(NS, 'svg')
    s.setAttribute('viewBox', `0 0 ${W} ${height}`)
    s.setAttribute('class', 'gardenStrip')
    s.setAttribute('role', 'img')
    s.setAttribute('aria-label', label)
    return s
  }
  const add = (parent: SVGElement, tag: string, attrs: Record<string, string>, text?: string, title?: string): SVGElement => {
    const n = document.createElementNS(NS, tag)
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v)
    if (text) n.textContent = text
    if (title) n.append(Object.assign(document.createElementNS(NS, 'title'), { textContent: title }))
    parent.append(n)
    return n
  }
  const labels = (s: SVGElement, y: number, month: number | null) => {
    MONTH_NAMES.forEach((m, i) => add(s, 'text', { x: String(i * SLOT + SLOT / 2), y: String(y), class: i === month ? 'barLabel on' : 'barLabel', 'text-anchor': 'middle' }, m[0]))
  }
  const highlight = (s: SVGElement, height: number, month: number | null) => {
    if (month !== null) add(s, 'rect', { class: 'monthMark', x: String(month * SLOT), y: '0', width: String(SLOT), height: String(height), rx: '3' })
  }

  function sunChart(sunMinutes: number[], month: number | null): HTMLElement {
    const H = 44
    const cells = sunStrip(sunMinutes)
    const s = svg(H + 14, `Direct sun a day at this spot by month: ${cells.map((c) => c.text).join('; ')}`)
    highlight(s, H + 14, month)
    cells.forEach((c, i) => {
      const h = Math.max(1, c.share * H)
      add(s, 'rect', { class: 'realBar', x: String(i * SLOT + (SLOT - BAR) / 2), y: String(H - h), width: String(BAR), height: String(h), rx: '2' }, undefined, c.text)
    })
    add(s, 'line', { class: 'baseline', x1: '0', x2: String(W), y1: String(H + 0.5), y2: String(H + 0.5) })
    labels(s, H + 12, month)
    const wrap = el('div', 'gardenChart')
    const most = sunMinutes.indexOf(Math.max(...sunMinutes))
    const least = sunMinutes.indexOf(Math.min(...sunMinutes))
    const range = sunMinutes[most] === sunMinutes[least] ? `${hoursText(sunMinutes[most])} a day all year` : `From ${hoursText(sunMinutes[least])} in ${MONTH_NAMES[least]} to ${hoursText(sunMinutes[most])} in ${MONTH_NAMES[most]}`
    wrap.append(el('span', 'chartLabel', 'Direct sun at this spot, hours a day'), s, el('span', 'chartCaption', range))
    return wrap
  }

  function tempChart(climate: Climate, month: number | null): HTMLElement {
    const H = 44
    const { cells, min, max, zeroShare } = tempStrip(climate)
    const s = svg(H + 14, `Typical low and high temperature by month: ${cells.map((c) => c.text).join('; ')}`)
    highlight(s, H + 14, month)
    if (zeroShare !== null) add(s, 'line', { class: 'zeroLine', x1: '0', x2: String(W), y1: String(H - zeroShare * H), y2: String(H - zeroShare * H) })
    cells.forEach((c, i) => {
      const top = H - c.highShare * H
      const h = Math.max(2, (c.highShare - c.lowShare) * H)
      add(s, 'rect', { class: 'tempBar', x: String(i * SLOT + (SLOT - BAR) / 2), y: String(top), width: String(BAR), height: String(h), rx: '2' }, undefined, c.text)
    })
    add(s, 'line', { class: 'baseline', x1: '0', x2: String(W), y1: String(H + 0.5), y2: String(H + 0.5) })
    labels(s, H + 12, month)
    const wrap = el('div', 'gardenChart')
    wrap.append(el('span', 'chartLabel', 'Typical night and day temperature, °C'), s, el('span', 'chartCaption', `Typical lows and highs run from ${Math.round(min)} to ${Math.round(max)} °C over the year`))
    return wrap
  }

  function rowItem(row: PlantRow, withGrowing: boolean): HTMLElement {
    const li = el('li', 'plantRow')
    const top = el('div', 'plantTop')
    top.append(el('strong', '', row.name), el('span', 'plantKind', row.kind), el('span', `rate ${row.rating}`, RATING_LABEL[row.rating]))
    li.append(top)
    if (withGrowing) li.append(el('span', 'plantGrowing', row.growing))
    li.append(el('span', 'plantReason', row.reason))
    return li
  }

  function plants(input: GardenCardInput, sunMinutes: number[]): HTMLElement {
    const indoor = input.kind === 'indoor'
    const ranked: PlantResult[] = rankPlants({ indoor, sunMinutes }, indoor ? NO_CLIMATE : input.climate!, input.month === null ? {} : { month: input.month })
    const { fit, poor } = splitPlants(ranked)
    const box = el('div', 'gardenPlants')
    const when = input.month === null ? '' : ` in ${MONTH_NAMES[input.month]}`
    box.append(
      el(
        'p',
        'plantsLead',
        fit.length === 0
          ? `Nothing in the catalogue does well here${when}.`
          : `${fit.length} of ${ranked.length} plants suit this spot${when}, best first.`,
      ),
    )
    if (fit.length > 0) {
      const list = el('ul', 'plantList')
      list.append(...fit.map((r) => rowItem(plantRow(r, input.month), true)))
      box.append(list)
    }
    if (poor.length > 0) {
      const more = el('details', 'plantsPoor')
      more.open = poorOpen
      more.addEventListener('toggle', () => {
        poorOpen = more.open
      })
      more.append(el('summary', '', `Why not others? (${poor.length})`))
      const list = el('ul', 'plantList')
      list.append(...poor.map((r) => rowItem(plantRow(r, input.month), false)))
      more.append(list)
      box.append(more)
    }
    return box
  }

  function busy(text: string, progress?: number): HTMLElement {
    const box = el('div', 'gardenBusy')
    box.append(Object.assign(el('p', 'cardBusy', text), { role: 'status' }))
    if (progress !== undefined) {
      const bar = el('div', 'gardenBar')
      bar.style.setProperty('--progress', `${Math.round(progress * 100)}%`)
      box.append(bar)
    }
    return box
  }

  function problem(text: string, action: string, onAction: () => void): HTMLElement {
    const box = el('div', 'gardenProblem')
    const p = el('p', 'cardVerdict warn', text)
    p.setAttribute('role', 'alert')
    const retry = Object.assign(el('button', 'link', action), { type: 'button' })
    retry.addEventListener('click', onAction)
    box.append(p, retry)
    return box
  }

  function caveat(): HTMLElement {
    const p = el('p', 'cardNote small')
    p.append(
      'An estimate: direct sun is traced in 3D on the 21st of each month, outdoor temperatures are NASA POWER averages, and plant needs are typical values for a common variety. ',
      Object.assign(document.createElement('a'), { href: ACCURACY_URL, target: '_blank', rel: 'noreferrer', textContent: 'Accuracy and limits' }),
    )
    return p
  }

  return {
    el: root,
    set(input) {
      const keepFocus = document.activeElement === select
      select.value = input.month === null ? '' : String(input.month)
      if (input.kind === null) {
        head.replaceChildren(el('p', 'cardNote', NO_SPOT_HINT), ...(input.hint ? [Object.assign(el('p', 'cardVerdict warn', input.hint), { role: 'status' })] : []))
        close.hidden = true
        body.replaceChildren()
        return
      }
      close.hidden = false
      const where = el('h4', '', WHERE[input.kind])
      head.replaceChildren(where, ...(input.kind === 'indoor' ? [el('p', 'cardNote small', INDOOR_NOTE)] : []), ...(input.hint ? [Object.assign(el('p', 'cardVerdict warn', input.hint), { role: 'status' })] : []))
      const { trace } = input
      if (trace.status === 'idle' || trace.status === 'running') {
        body.replaceChildren(busy('Measuring the sun at this spot…', trace.status === 'running' ? trace.progress : 0))
        return
      }
      if (trace.status === 'error') {
        body.replaceChildren(problem(trace.message, 'Try again', options.onRetryTrace))
        return
      }
      const parts: HTMLElement[] = [sunChart(trace.sunMinutes, input.month)]
      const outdoor = input.kind !== 'indoor'
      if (outdoor && input.weather === 'error') {
        parts.push(problem('Local temperatures could not be loaded (NASA POWER). Outdoor plants cannot be rated without them.', 'Retry the temperatures', options.onRetryClimate))
      } else if (outdoor && (input.weather !== 'ready' || !input.climate)) {
        parts.push(busy('Loading local temperatures…'))
      } else {
        if (outdoor) parts.push(tempChart(input.climate!, input.month))
        results.replaceChildren(plants(input, trace.sunMinutes))
        parts.push(filter, results, caveat())
      }
      body.replaceChildren(...parts)
      if (keepFocus) select.focus()
    },
  }
}
