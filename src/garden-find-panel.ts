import { type FindKind, type KindStats } from './garden-find'
import type { GardenTrace } from './garden-card'
import { monthLabel as monthText, type DeadEnd } from './garden-text'
import { fmtMonth, t, upFirst, type Key } from './i18n'
import { PLANTS, plantMatches, plantName, type Plant, type PlantKind } from './plants'

// "Find a place for ...": the plant picker of the Garden view, the colour legend of the plant map and its summary.
// main.ts feeds it; the map itself is painted by the scene.

export interface FindInput {
  plantId: string | null
  /** 0 = January; null = the whole year. */
  month: number | null
  trace: GardenTrace
  weather: 'idle' | 'loading' | 'ready' | 'error'
  /** Whether the plant can stand outdoors, so the local climate matters. */
  needsClimate: boolean
  summary: string
  /** The way on when the summary says no spot suits: the months that work, with a switch to the best one. */
  deadEnd?: DeadEnd
  /** Why some kinds of spots are skipped. */
  note?: string
  stats: KindStats[]
  canShowBest: boolean
  /** The floors above are hidden, so the roof spots are left out of the summary and counts. */
  roofHidden?: boolean
}

export interface FindPanel {
  el: HTMLElement
  /** The Month control, shared by the spot card and the plant map; the caller places it. */
  monthEl: HTMLElement
  set(input: FindInput): void
}

const GROUPS: { kinds: PlantKind[]; label: Key }[] = [
  { kinds: ['vegetable', 'fruit'], label: 'garden.groupVegFruit' },
  { kinds: ['herb'], label: 'garden.groupHerbs' },
  { kinds: ['flower'], label: 'garden.groupFlowers' },
  { kinds: ['houseplant'], label: 'garden.groupHouseplants' },
]
const KIND_WORD: Record<FindKind, Key> = { indoor: 'garden.kindIndoors', ground: 'garden.kindGround', roof: 'garden.kindRoof' }
/** How many rows the plant list shows while a search is typed. */
const SEARCH_ROWS = 6

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] =>
  Object.assign(document.createElement(tag), { className, textContent: text })

const option = (value: string, text: string): HTMLOptionElement => Object.assign(document.createElement('option'), { value, textContent: text })

export function createFindPanel(options: {
  onPlant: (id: string | null) => void
  onMonth: (month: number | null) => void
  onBest: () => void
  onRetryClimate: () => void
  onRetryTrace: () => void
}): FindPanel {
  const root = el('div', 'findPanel')
  root.setAttribute('role', 'region')
  root.setAttribute('aria-label', t('garden.findAria'))
  const search = el('input')
  search.type = 'search'
  search.className = 'plantSearch'
  search.placeholder = t('garden.searchPlaceholder')
  search.setAttribute('aria-label', t('garden.searchAria'))
  search.autocomplete = 'off'
  const plantSelect = el('select')
  plantSelect.setAttribute('aria-label', t('garden.plantAria'))
  let chosenId = ''
  /** The plant list: every plant, or those whose English or Italian name matches the search (a short list box while searching). */
  const fillPlants = (query: string) => {
    const matches = (p: Plant) => plantMatches(p, query)
    const searching = query.trim() !== ''
    plantSelect.replaceChildren(...(searching ? [] : [option('', t('garden.choosePlant'))]))
    for (const g of GROUPS) {
      const group = document.createElement('optgroup')
      group.label = t(g.label)
      const plants = PLANTS.filter((x) => g.kinds.includes(x.kind) && matches(x))
      for (const p of plants) group.append(option(p.id, upFirst(plantName(p))))
      if (group.children.length > 0) plantSelect.append(group)
    }
    const found = plantSelect.querySelectorAll('option').length - (searching ? 0 : 1)
    if (searching && found === 0) plantSelect.append(Object.assign(option('', t('garden.noPlantMatch')), { disabled: true }))
    plantSelect.size = searching ? Math.min(SEARCH_ROWS, Math.max(1, found + plantSelect.querySelectorAll('optgroup').length)) : 0
    plantSelect.value = chosenId
  }
  fillPlants('')
  search.addEventListener('input', () => fillPlants(search.value))
  // Enter in the search box picks the plant when exactly one matches.
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return
    const only = plantSelect.querySelectorAll<HTMLOptionElement>('option:not([disabled])')
    if (search.value.trim() === '' || only.length !== 1) return
    e.preventDefault()
    plantSelect.value = only[0].value
    plantSelect.dispatchEvent(new Event('change'))
  })
  plantSelect.addEventListener('change', () => {
    chosenId = plantSelect.value
    options.onPlant(chosenId === '' ? null : chosenId)
  })

  const monthLabel = el('label', 'monthRow')
  const monthSelect = el('select')
  monthSelect.append(option('', t('garden.monthAllYear')))
  for (let i = 0; i < 12; i++) monthSelect.append(option(String(i), monthText(i)))
  monthSelect.addEventListener('change', () => options.onMonth(monthSelect.value === '' ? null : Number(monthSelect.value)))
  monthLabel.append(el('span', '', t('garden.month')), monthSelect)

  const result = el('div', 'findResult')
  root.append(search, plantSelect, result)

  const swatch = (kind: 'good' | 'ok' | 'none', text: string): HTMLElement => {
    const s = el('span', 'legendItem')
    const box = el('i', `legendSwatch ${kind}`)
    box.setAttribute('aria-hidden', 'true')
    s.append(box, text)
    return s
  }
  const withRole = <T extends HTMLElement>(node: T, role: string): T => {
    node.setAttribute('role', role)
    return node
  }
  const button = (text: string, onClick: () => void): HTMLButtonElement => {
    const b = el('button', 'link', text)
    b.type = 'button'
    b.addEventListener('click', onClick)
    return b
  }

  return {
    el: root,
    monthEl: monthLabel,
    set(input) {
      const keepFocus = document.activeElement === plantSelect || document.activeElement === monthSelect ? document.activeElement : null
      chosenId = input.plantId ?? ''
      plantSelect.value = chosenId
      monthSelect.value = input.month === null ? '' : String(input.month)
      if (!input.plantId) return result.replaceChildren()
      const parts: HTMLElement[] = []
      const { trace } = input
      if (trace.status === 'idle' || trace.status === 'running') {
        const pct = trace.status === 'running' ? Math.round(trace.progress * 100) : 0
        const bar = el('div', 'gardenBar')
        bar.style.setProperty('--progress', `${pct}%`)
        parts.push(withRole(el('p', 'cardBusy', t('garden.findMeasuring', { pct })), 'status'), bar)
      } else if (trace.status === 'error') {
        parts.push(withRole(el('p', 'cardVerdict warn', trace.message), 'alert'), button(t('garden.tryAgain'), options.onRetryTrace))
      } else {
        if (input.needsClimate && input.weather === 'error') {
          parts.push(
            withRole(el('p', 'cardVerdict warn', t('garden.findNoTemps')), 'alert'),
            button(t('garden.retryTemps'), options.onRetryClimate),
          )
        } else if (input.needsClimate && input.weather !== 'ready') {
          parts.push(withRole(el('p', 'cardBusy', t('garden.loadingTemps')), 'status'))
        }
        const legend = el('div', 'findLegend')
        legend.setAttribute('aria-label', t('garden.legendAria'))
        legend.append(swatch('good', t('garden.legendGood')), swatch('ok', t('garden.legendOk')), swatch('none', t('garden.legendPoor')))
        parts.push(legend)
        if (input.summary) parts.push(withRole(el('p', 'findSummary', input.summary), 'status'))
        if (input.deadEnd) {
          const line = el('p', 'findNext', input.deadEnd.text)
          const m = input.deadEnd.switchMonth
          if (m !== undefined) line.append(' ', button(t('garden.showMonth', { month: fmtMonth(m) }), () => options.onMonth(m)))
          parts.push(line)
        }
        if (input.stats.length > 0) {
          const list = el('ul', 'findCounts')
          for (const s of input.stats) {
            const li = el('li')
            li.append(el('strong', '', `${t(KIND_WORD[s.kind])}: `), t('garden.counts', { good: s.good, ok: s.ok, total: s.total }))
            list.append(li)
          }
          parts.push(list)
        }
        if (input.roofHidden) parts.push(el('p', 'cardNote small', t('garden.roofHidden')))
        if (input.canShowBest) parts.push(button(t('garden.best'), options.onBest))
      }
      if (input.note) parts.push(el('p', 'cardNote small', input.note))
      result.replaceChildren(...parts)
      if (keepFocus instanceof HTMLElement) keepFocus.focus()
    },
  }
}
