import { rankPlants, type PlantResult } from './garden'
import type { PickedKind } from './garden-pick'
import {
  INDOOR_NOTE, MONTH_NAMES, NO_SPOT_HINT, RATING_LABEL, hoursText, plantRow, spotDeadEnd, splitPlants, sunStrip, topPlants, tempStrip, whereText, type PlantRow,
} from './garden-text'
import { ACCURACY_URL } from './panel-card'
import type { Climate } from './weather'

// The Garden spot card: what the sun and the weather at one clicked spot let grow. It is docked in the left panel of the
// Garden view; main.ts feeds it. It leads with where the spot is and the best plants, then the months of sun and temperature, then the full list.

export type GardenTrace =
  | { status: 'idle' }
  | { status: 'running'; progress: number }
  | { status: 'done'; sunMinutes: number[] }
  | { status: 'error'; message: string }

export interface GardenCardInput {
  /** Null before a spot is picked. */
  kind: PickedKind | null
  /** A roof spot on another building than the picked one. */
  neighbourRoof?: boolean
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

export function createGardenCard(options: { onRetryClimate: () => void; onRetryTrace: () => void; onClose: () => void; onMonth: (month: number) => void }): GardenCard {
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
  const results = el('div', 'gardenResults')
  root.append(head, close, body)
  let poorOpen = false
  let allOpen = false

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
    wrap.append(el('span', 'chartLabel', 'Direct sun around this spot, hours a day'), s, el('span', 'chartCaption', range))
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
      add(s, 'rect', { class: c.cold ? 'tempBar cold' : 'tempBar', x: String(i * SLOT + (SLOT - BAR) / 2), y: String(top), width: String(BAR), height: String(h), rx: '2' }, undefined, c.text)
    })
    add(s, 'line', { class: 'baseline', x1: '0', x2: String(W), y1: String(H + 0.5), y2: String(H + 0.5) })
    labels(s, H + 12, month)
    const wrap = el('div', 'gardenChart')
    const cold = cells.some((c) => c.cold)
    wrap.append(
      el('span', 'chartLabel', 'Typical night to day, °C'),
      s,
      el('span', 'chartCaption', `${cold ? 'Blue: near freezing. ' : ''}${Math.round(min)} to ${Math.round(max)} °C over the year.`),
    )
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

  /** The spot's plants in two parts: the answer (lead, best rows, "Show all") shown first, and the poor ones kept after the strips. */
  function plants(input: GardenCardInput, sunMinutes: number[]): { answer: HTMLElement; rest: HTMLElement } {
    const indoor = input.kind === 'indoor'
    const ranked: PlantResult[] = rankPlants({ indoor, sunMinutes }, indoor ? NO_CLIMATE : input.climate!, input.month === null ? {} : { month: input.month })
    const { fit, poor } = splitPlants(ranked)
    const answer = el('div', 'gardenPlants gardenAnswer')
    const box = el('div', 'gardenPlants')
    const when = input.month === null ? '' : ` in ${MONTH_NAMES[input.month]}`
    answer.append(
      el(
        'p',
        'plantsLead',
        fit.length === 0
          ? `Nothing in the catalogue does well here${when}.`
          : `${fit.length} of ${ranked.length} plants suit this spot${when}, best first.`,
      ),
    )
    if (fit.length === 0) {
      const rated = input.month === null ? ranked : rankPlants({ indoor, sunMinutes }, indoor ? NO_CLIMATE : input.climate!)
      const out = spotDeadEnd(rated, input.month)
      if (out) {
        const line = el('p', 'plantsNext', out.text)
        if (out.switchMonth !== undefined) {
          const month = out.switchMonth
          const go = Object.assign(el('button', 'link', `Show ${MONTH_NAMES[month]}`), { type: 'button' })
          go.addEventListener('click', () => options.onMonth(month))
          line.append(' ', go)
        }
        answer.append(line)
      }
    }
    if (fit.length > 0) {
      const { shown, rest } = topPlants(fit)
      const list = el('ul', 'plantList')
      list.append(...shown.map((r) => rowItem(plantRow(r, input.month), true)))
      answer.append(list)
      if (rest.length > 0) {
        const all = el('details', 'plantsAll')
        all.open = allOpen
        all.addEventListener('toggle', () => {
          allOpen = all.open
        })
        all.append(el('summary', '', `Show all ${fit.length}`))
        const more = el('ul', 'plantList')
        more.append(...rest.map((r) => rowItem(plantRow(r, input.month), true)))
        all.append(more)
        answer.append(all)
      }
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
    return { answer, rest: box }
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
      if (input.kind === null) {
        head.replaceChildren(el('p', 'gardenPrompt', NO_SPOT_HINT), ...(input.hint ? [Object.assign(el('p', 'cardVerdict warn', input.hint), { role: 'status' })] : []))
        close.hidden = true
        body.replaceChildren()
        return
      }
      close.hidden = false
      const where = el('h4', '', whereText(input.kind, input.neighbourRoof))
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
      const sun = sunChart(trace.sunMinutes, input.month)
      const parts: HTMLElement[] = [sun]
      const outdoor = input.kind !== 'indoor'
      if (outdoor && input.weather === 'error') {
        parts.push(problem('Local temperatures could not be loaded (NASA POWER). Outdoor plants cannot be rated without them.', 'Retry the temperatures', options.onRetryClimate))
      } else if (outdoor && (input.weather !== 'ready' || !input.climate)) {
        parts.push(busy('Loading local temperatures…'))
      } else {
        const { answer, rest } = plants(input, trace.sunMinutes)
        parts.unshift(answer)
        if (outdoor) parts.push(tempChart(input.climate!, input.month))
        results.replaceChildren(rest)
        parts.push(results, caveat())
      }
      body.replaceChildren(...parts)
    },
  }
}
