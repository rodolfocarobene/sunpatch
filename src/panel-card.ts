import type { PanelShade } from './panel-shade'
import type { Verdict } from './panel-verdict'
import { DEFAULT_ASSUMPTIONS, type Assumptions, type PanelEnergy } from './solar'
import { clock, FULL_SUN_MINUTES, sunColor, sunGradient } from './sunmap'

// The panel card: what the shading analysis says about the selected panel. It leads with one sentence and a yardstick,
// and keeps the figures and charts under "Details". It is docked in the left panel of the Panels view; main.ts feeds it.

export type CardState =
  | { status: 'idle' }
  | { status: 'computing' }
  | { status: 'ready'; shade: PanelShade; energy: EnergyView }
  | { status: 'error'; message: string }

/** What the energy block shows: the figures, the state of the weather data and the assumptions behind them. */
export interface EnergyView {
  energy: PanelEnergy
  weather: 'loading' | 'ready' | 'error'
  assumptions: Assumptions
  /** Area of the whole row, m2. */
  area: number
  /** The sentence the card leads with, and the yardstick line under it (null when there is nothing to compare). */
  verdict: Verdict
  reference: string | null
}

export const ACCURACY_URL = 'https://github.com/rodolfocarobene/sunpatch#accuracy-and-limitations'

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
/** The chart's hours (start of the hour, local time); widened when the sun is up outside them. */
const FIRST_HOUR = 4
const LAST_HOUR = 21
const LABELLED_HOURS = new Set([6, 9, 12, 15, 18, 21])

export interface CellInfo {
  kind: 'night' | 'behind' | 'sun'
  /** Share of the panel in direct sun, 0..1 (0 for night and behind). */
  share: number
  text: string
}

/** What one month x hour cell shows and says: "June, 15:00–16:00: 80% of the panel in sun". */
export function cellInfo(shade: PanelShade, month: number, hour: number): CellInfo {
  const when = `${MONTH_NAMES[month]}, ${clock(hour * 60)}–${clock(hour * 60 + 60)}`
  if (shade.up[month][hour] === 0) return { kind: 'night', share: 0, text: `${when}: sun below the horizon` }
  if (shade.front[month][hour] === 0) return { kind: 'behind', share: 0, text: `${when}: sun behind the panel` }
  const share = shade.lit[month][hour]
  const behind = shade.front[month][hour] < 0.99 ? '; sun behind the panel for part of the hour' : ''
  return { kind: 'sun', share, text: `${when}: ${Math.round(share * 100)}% of the panel in sun${behind}` }
}

/** The hours the chart covers: 4 to 21, wider if the sun is up before or after. */
export function chartHours(shade: PanelShade): [number, number] {
  let first = FIRST_HOUR
  let last = LAST_HOUR
  for (const row of shade.up) {
    row.forEach((v, h) => {
      if (v > 0) {
        first = Math.min(first, h)
        last = Math.max(last, h)
      }
    })
  }
  return [first, last]
}

export const formatKwh = (kwh: number): string => `${Math.round(kwh).toLocaleString('en')} kWh`

/** "Shading costs 120 kWh (8%)", or the good news. */
export function shadingLine(e: PanelEnergy): string {
  if (e.idealOpen <= 0) return ''
  if (e.shadingCost < 0.5) return 'Nothing shades this panel'
  return `Shading costs ${formatKwh(e.shadingCost)} (${formatLoss(e.shadingShare)})`
}

export const formatHours = (h: number): string => `${Math.round(h).toLocaleString('en')} h`

/** "12%"; "<1%" for a small loss that would round to nothing. */
export const formatLoss = (loss: number): string => (loss > 0 && loss < 0.005 ? '<1%' : `${Math.round(loss * 100)}%`)

const rgbCss = (minutes: number): string => `rgb(${sunColor(minutes).join(', ')})`

export interface PanelCard {
  el: HTMLElement
  set(state: CardState): void
}

/** A card; `onClose` adds a close button. */
export function createPanelCard(options: { onClose?: () => void; onAssumptions?: (a: Assumptions) => void; onRetry?: () => void } = {}): PanelCard {
  let assumptionsOpen = false
  let detailsOpen = false
  const el = document.createElement('div')
  el.className = 'panelCard'
  el.hidden = true
  el.setAttribute('role', 'region')
  el.setAttribute('aria-label', 'Shading of the selected panel')
  const tip = document.createElement('div')
  tip.className = 'heatTip'
  tip.hidden = true
  tip.setAttribute('role', 'tooltip')
  document.body.appendChild(tip)

  const body = document.createElement('div')
  body.className = 'cardBody'
  const title = Object.assign(document.createElement('h4'), { textContent: 'Selected panel' })
  el.append(title, body)
  if (options.onClose) {
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'cardClose'
    close.title = 'Close (Esc)'
    close.setAttribute('aria-label', 'Close')
    close.innerHTML = '<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>'
    close.addEventListener('click', options.onClose)
    el.append(close)
  }

  const hideTip = () => {
    tip.hidden = true
  }
  const showTip = (cell: HTMLElement, text: string) => {
    tip.textContent = text
    tip.hidden = false
    const r = cell.getBoundingClientRect()
    const w = tip.offsetWidth
    tip.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`
    tip.style.top = `${r.top - tip.offsetHeight - 8 < 8 ? r.bottom + 8 : r.top - tip.offsetHeight - 8}px`
  }

  function figures(shade: PanelShade): HTMLElement {
    const dl = document.createElement('dl')
    dl.className = 'cardFigures'
    const row = (name: string, value: string, hint: string): void => {
      const dt = Object.assign(document.createElement('dt'), { textContent: name, title: hint })
      const dd = Object.assign(document.createElement('dd'), { textContent: value, title: hint })
      dl.append(dt, dd)
    }
    row('Direct sun a year', formatHours(shade.annualHours), 'Hours the sun reaches the face, from the 21st of each month scaled to the year (partly shaded hours count in part)')
    row(
      'Lost to shading',
      shade.potentialHours > 0 ? formatLoss(shade.shadingLoss) : 'none',
      'Share of the energy the face could get from direct sun that obstacles take away, weighted by the angle of the sun',
    )
    row('With no obstacles', formatHours(shade.potentialHours), 'Hours the sun is in front of the face, with nothing in the way')
    return dl
  }

  function chart(shade: PanelShade): HTMLElement {
    const [first, last] = chartHours(shade)
    const table = document.createElement('table')
    table.className = 'heat'
    table.setAttribute('aria-label', 'Share of the panel in direct sun, by month and hour')
    const head = table.createTHead().insertRow()
    head.append(document.createElement('td'))
    for (let h = first; h <= last; h++) {
      const th = document.createElement('th')
      th.scope = 'col'
      th.textContent = LABELLED_HOURS.has(h) ? String(h) : ''
      th.setAttribute('aria-label', `${clock(h * 60)}`)
      head.append(th)
    }
    const rows = table.createTBody()
    for (let m = 0; m < 12; m++) {
      const tr = rows.insertRow()
      const th = Object.assign(document.createElement('th'), { scope: 'row', textContent: MONTH_NAMES[m].slice(0, 3) })
      tr.append(th)
      for (let h = first; h <= last; h++) {
        const info = cellInfo(shade, m, h)
        const td = document.createElement('td')
        td.className = info.kind
        td.setAttribute('aria-label', info.text)
        if (info.kind === 'sun') td.style.background = rgbCss(info.share * FULL_SUN_MINUTES)
        td.addEventListener('mouseenter', () => showTip(td, info.text))
        td.addEventListener('mouseleave', hideTip)
        tr.append(td)
      }
    }
    table.addEventListener('mouseleave', hideTip)
    return table
  }

  function bars(view: EnergyView): HTMLElement {
    const { energy, weather } = view
    const realistic = weather === 'ready' && energy.monthWeather ? energy.monthWeather : undefined
    const top = Math.max(...energy.monthIdeal, 1)
    const W = 252
    const H = 64
    const slot = W / 12
    const bar = 14
    const ns = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(ns, 'svg')
    svg.setAttribute('viewBox', `0 0 ${W} ${H + 14}`)
    svg.setAttribute('class', 'energyBars')
    svg.setAttribute('role', 'img')
    svg.setAttribute('aria-label', `Energy by month in kWh${realistic ? ', with local weather and ideal' : ', ideal'}`)
    const add = (tag: string, attrs: Record<string, string>, text?: string) => {
      const n = document.createElementNS(ns, tag)
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v)
      if (text) n.textContent = text
      svg.append(n)
      return n
    }
    for (let m = 0; m < 12; m++) {
      const x = m * slot + (slot - bar) / 2
      const ideal = (energy.monthIdeal[m] / top) * H
      const real = realistic ? (realistic[m] / top) * H : 0
      const text = `${MONTH_NAMES[m]}: ${realistic ? `${formatKwh(realistic[m])} with weather, ` : ''}${formatKwh(energy.monthIdeal[m])} ideal`
      if (realistic) add('rect', { class: 'idealMark', x: String(x), y: String(H - ideal + 0.5), width: String(bar), height: String(Math.max(0, ideal - 1)), rx: '2' })
      add('rect', { class: 'realBar', x: String(x), y: String(H - (realistic ? real : ideal)), width: String(bar), height: String(Math.max(1, realistic ? real : ideal)), rx: '2' })
      add('text', { x: String(x + bar / 2), y: String(H + 11), class: 'barLabel', 'text-anchor': 'middle' }, MONTH_NAMES[m][0])
      const hit = add('rect', { x: String(m * slot), y: '0', width: String(slot), height: String(H + 14), fill: 'transparent', tabindex: '0', 'aria-label': text }) as SVGElement
      hit.addEventListener('mouseenter', () => showTip(hit as unknown as HTMLElement, text))
      hit.addEventListener('focus', () => showTip(hit as unknown as HTMLElement, text))
      hit.addEventListener('mouseleave', hideTip)
      hit.addEventListener('blur', hideTip)
    }
    add('line', { class: 'baseline', x1: '0', x2: String(W), y1: String(H + 0.5), y2: String(H + 0.5) })
    const wrap = document.createElement('div')
    wrap.className = 'energyChart'
    wrap.append(svg)
    const key = document.createElement('div')
    key.className = 'energyKey'
    key.innerHTML = realistic
      ? '<span><i class="swatch real" aria-hidden="true"></i>With local weather</span><span><i class="swatch ideal" aria-hidden="true"></i>Ideal, clear sky</span>'
      : '<span><i class="swatch real" aria-hidden="true"></i>Ideal, clear sky, kWh a month</span>'
    wrap.append(key)
    return wrap
  }

  function assumptions(view: EnergyView): HTMLElement {
    const details = document.createElement('details')
    details.className = 'assumptions'
    details.open = assumptionsOpen
    details.addEventListener('toggle', () => {
      assumptionsOpen = details.open
    })
    const summary = Object.assign(document.createElement('summary'), { textContent: 'Assumptions' })
    const field = (label: string, value: number, min: number, max: number, set: (v: number) => Assumptions): HTMLElement => {
      const l = document.createElement('label')
      const input = document.createElement('input')
      input.type = 'number'
      input.min = String(min)
      input.max = String(max)
      input.step = '1'
      input.value = String(Math.round(value * 100))
      input.addEventListener('change', () => {
        const v = Number(input.value)
        if (!Number.isFinite(v) || v < min || v > max) {
          input.value = String(Math.round(value * 100))
          return
        }
        options.onAssumptions?.(set(v / 100))
      })
      l.append(`${label} `, input, ' %')
      return l
    }
    const a = view.assumptions
    const grid = document.createElement('div')
    grid.className = 'assumeFields'
    grid.append(
      field('Module efficiency', a.efficiency, 5, 40, (v) => ({ ...a, efficiency: v })),
      field('System losses', a.losses, 0, 60, (v) => ({ ...a, losses: v })),
    )
    const reset = Object.assign(document.createElement('button'), { type: 'button', className: 'link', textContent: 'Reset' })
    reset.addEventListener('click', () => options.onAssumptions?.({ ...DEFAULT_ASSUMPTIONS }))
    const facts = note(
      `This panel is about ${view.energy.kwp.toFixed(2)} kWp (${view.area.toFixed(2)} m\u00b2 at ${Math.round(a.efficiency * 100)}%). kWp is the panel's rated power; 1 kWp is about 5 m\u00b2 of panels. Losses cover wiring, inverter, heat and dirt; 14% is the PVGIS convention.`,
      'cardNote small',
    )
    details.append(summary, grid, facts, reset)
    return details
  }

  /** The sentence, the yardstick under it and, when the weather could not load, the way to retry. */
  function headline(view: EnergyView): HTMLElement {
    const box = document.createElement('section')
    box.className = 'cardHead'
    box.setAttribute('aria-label', 'Summary')
    const { verdict } = view
    const sentence = note(verdict.sentence, verdict.warning ? 'cardVerdict warn' : 'cardVerdict')
    if (verdict.warning) sentence.setAttribute('role', 'alert')
    box.append(sentence)
    if (view.weather === 'error') {
      const retry = Object.assign(document.createElement('button'), { type: 'button', className: 'link', textContent: 'Retry the weather' })
      retry.addEventListener('click', () => options.onRetry?.())
      box.append(retry)
    }
    if (view.reference && !verdict.warning) box.append(note(view.reference))
    return box
  }

  /** Everything behind the sentence: the clear-sky figure, the months, the sun hours, the chart and the assumptions. */
  function details(view: EnergyView, shade: PanelShade): HTMLElement {
    const box = document.createElement('details')
    box.className = 'cardDetails'
    box.open = detailsOpen
    box.addEventListener('toggle', () => {
      detailsOpen = box.open
    })
    box.append(Object.assign(document.createElement('summary'), { textContent: 'Details' }))
    const ideal = document.createElement('div')
    ideal.className = 'energyIdeal'
    ideal.append(
      Object.assign(document.createElement('span'), { textContent: 'Ideal (clear sky)' }),
      Object.assign(document.createElement('strong'), { textContent: `${formatKwh(view.energy.ideal)} a year` }),
    )
    const shading = shadingLine(view.energy)
    box.append(ideal, ...(shading ? [note(shading, 'energyShading')] : []), bars(view), figures(shade))
    if (shade.potentialHours > 0) {
      box.append(chart(shade), legend())
    } else box.append(note('The sun never reaches the front of this panel.'))
    box.append(
      note('The 21st of each month in 15 minute steps. Neighbours, trees, the building and other panels shade it.', 'cardNote small'),
      assumptions(view),
    )
    return box
  }

  function legend(): HTMLElement {
    const box = document.createElement('div')
    box.className = 'heatLegend'
    box.innerHTML = `
      <span class="legendLabel">Share of the panel in direct sun</span>
      <div class="legendBar" style="background:${sunGradient()}" aria-hidden="true"></div>
      <div class="legendTicks" aria-hidden="true"><span>0%</span><span>50%</span><span>100%</span></div>
      <div class="legendKeys">
        <span><i class="key behind" aria-hidden="true"></i>Sun behind the panel</span>
        <span><i class="key night" aria-hidden="true"></i>Night</span>
      </div>`
    return box
  }

  function note(text: string, className = 'cardNote'): HTMLElement {
    return Object.assign(document.createElement('p'), { className, textContent: text })
  }

  return {
    el,
    set(state) {
      hideTip()
      el.hidden = state.status === 'idle'
      el.dataset.status = state.status
      if (state.status === 'computing') body.replaceChildren(note('Computing…', 'cardBusy'))
      else if (state.status === 'error') body.replaceChildren(note(state.message, 'cardBusy'))
      else if (state.status === 'ready') {
        const { shade } = state
        const caveat = document.createElement('p')
        caveat.className = 'cardNote small'
        caveat.append(
          'An estimate: direct sun is traced in 3D, weather comes from NASA POWER averages. ',
          Object.assign(document.createElement('a'), { href: ACCURACY_URL, target: '_blank', rel: 'noreferrer', textContent: 'Accuracy and limits' }),
        )
        body.replaceChildren(headline(state.energy), details(state.energy, shade), caveat)
      }
    },
  }
}
