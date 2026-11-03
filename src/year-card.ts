import { fmtMonth, t } from './i18n'
import { duration } from './sunmap'
import { barFractions, yearSummary } from './year'

// The "Through the year" disclosure under the headline: a collapsed-by-default <details> (remembered for the session)
// with the summary line and 12 bars, one per month. The bars are buttons: hover or focus reads the value, a click picks that day.

const OPEN_KEY = 'sunpatch.yearOpen'

export type YearCardState =
  | { kind: 'idle' }
  | { kind: 'running'; progress: number }
  | { kind: 'ready'; minutes: number[] }
  | { kind: 'error' }

export interface YearCard {
  /** Whether the disclosure is open (the chart is only worked out then). */
  readonly open: boolean
  /** Shown only when there is an apartment with windows to trace. */
  setAvailable(available: boolean): void
  /** The chosen date's month (0-11): its bar is highlighted. */
  setMonth(month: number): void
  setState(state: YearCardState): void
  onToggle(listener: (open: boolean) => void): void
  /** A bar was clicked: the month, 0-11. */
  onPick(listener: (month: number) => void): void
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

export function createYearCard(root: HTMLElement): YearCard {
  const details = el('details', 'yearBox')
  details.append(el('summary', '', t('year.title')))
  const body = el('div', 'yearBody')
  details.append(body)
  root.append(details)
  root.hidden = true

  try {
    details.open = sessionStorage.getItem(OPEN_KEY) === '1'
  } catch { /* storage can be blocked */ }

  let state: YearCardState = { kind: 'idle' }
  let month = new Date().getMonth()
  let pickListener: ((month: number) => void) | undefined
  let toggleListener: ((open: boolean) => void) | undefined

  function render() {
    body.replaceChildren()
    if (state.kind === 'running') {
      const done = Math.min(12, Math.floor(state.progress * 12))
      const p = el('p', 'yearStatus', t('year.working', { done, total: 12 }))
      p.setAttribute('role', 'status')
      body.append(p)
    } else if (state.kind === 'error') {
      body.append(el('p', 'yearStatus', t('year.error')))
    } else if (state.kind === 'ready') chart(state.minutes)
  }

  function chart(minutes: number[]) {
    const max = Math.max(...minutes)
    const read = el('p', 'yearRead')
    const label = (m: number) =>
      minutes[m] > 0 ? t('year.bar', { month: fmtMonth(m), duration: duration(minutes[m]) }) : t('year.barNone', { month: fmtMonth(m) })
    const showChosen = () => {
      read.textContent = label(month)
    }
    const fractions = barFractions(minutes)
    const bars = el('div', 'yearBars')
    bars.setAttribute('role', 'group')
    bars.setAttribute('aria-label', t('year.chart'))
    for (let m = 0; m < 12; m++) {
      const bar = el('button', 'yearBar')
      bar.type = 'button'
      bar.setAttribute('aria-label', label(m))
      bar.setAttribute('aria-pressed', m === month ? 'true' : 'false')
      bar.title = label(m)
      const fill = el('i')
      fill.style.height = `${Math.max(fractions[m] * 100, minutes[m] > 0 ? 3 : 0)}%`
      const track = el('b')
      track.append(fill)
      bar.append(track, el('span', '', fmtMonth(m, 'short')))
      const show = () => {
        read.textContent = label(m)
      }
      bar.addEventListener('mouseenter', show)
      bar.addEventListener('focus', show)
      bar.addEventListener('mouseleave', showChosen)
      bar.addEventListener('blur', showChosen)
      bar.addEventListener('click', () => pickListener?.(m))
      bars.append(bar)
    }
    showChosen()
    const top = el('p', 'yearMax', max > 0 ? t('year.max', { duration: duration(max) }) : '')
    body.append(el('p', 'yearSummary', yearSummary(minutes)), top, bars, read, el('p', 'legendNote', t('year.note')))
  }

  details.addEventListener('toggle', () => {
    try {
      sessionStorage.setItem(OPEN_KEY, details.open ? '1' : '0')
    } catch { /* storage can be blocked */ }
    toggleListener?.(details.open)
  })

  return {
    get open() {
      return details.open
    },
    setAvailable(available) {
      root.hidden = !available
    },
    setMonth(m) {
      if (m === month) return
      month = m
      if (state.kind === 'ready') render()
    },
    setState(s) {
      state = s
      render()
    },
    onToggle(fn) {
      toggleListener = fn
    },
    onPick(fn) {
      pickListener = fn
    },
  }
}
