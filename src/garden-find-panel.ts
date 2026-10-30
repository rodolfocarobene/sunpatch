import { cssColor, STEP_COLORS, type FindKind, type KindStats } from './garden-find'
import type { GardenTrace } from './garden-card'
import { MONTH_NAMES } from './garden-text'
import { PLANTS, type PlantKind } from './plants'

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
  /** Why some kinds of spots are skipped. */
  note?: string
  stats: KindStats[]
  canShowBest: boolean
}

export interface FindPanel {
  el: HTMLElement
  set(input: FindInput): void
}

const GROUPS: { kind: PlantKind; label: string }[] = [
  { kind: 'vegetable', label: 'Vegetables' },
  { kind: 'fruit', label: 'Fruit' },
  { kind: 'herb', label: 'Herbs' },
  { kind: 'flower', label: 'Flowers' },
  { kind: 'houseplant', label: 'Houseplants' },
]
const KIND_WORD: Record<FindKind, string> = { indoor: 'Indoors', ground: 'Ground', roof: 'Roof' }
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

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
  root.setAttribute('aria-label', 'Find a place for a plant')
  const plantLabel = el('label', 'findRow')
  const plantSelect = el('select')
  plantSelect.append(option('', 'Choose a plant…'))
  for (const g of GROUPS) {
    const group = document.createElement('optgroup')
    group.label = g.label
    for (const p of PLANTS.filter((x) => x.kind === g.kind)) group.append(option(p.id, cap(p.name)))
    if (group.children.length > 0) plantSelect.append(group)
  }
  plantSelect.addEventListener('change', () => options.onPlant(plantSelect.value === '' ? null : plantSelect.value))
  plantLabel.append(el('span', 'findLabel', 'Find a place for'), plantSelect)

  const monthLabel = el('label', 'findRow')
  const monthSelect = el('select')
  monthSelect.append(option('', 'All year'))
  MONTH_NAMES.forEach((m, i) => monthSelect.append(option(String(i), m)))
  monthSelect.addEventListener('change', () => options.onMonth(monthSelect.value === '' ? null : Number(monthSelect.value)))
  monthLabel.append(el('span', 'findLabel', 'Month'), monthSelect)

  const result = el('div', 'findResult')
  root.append(plantLabel, monthLabel, result)

  const swatch = (css: string | null, text: string): HTMLElement => {
    const s = el('span', 'legendItem')
    const box = el('i', css ? 'legendSwatch' : 'legendSwatch none')
    if (css) box.style.background = css
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
    set(input) {
      const keepFocus = document.activeElement === plantSelect || document.activeElement === monthSelect ? document.activeElement : null
      plantSelect.value = input.plantId ?? ''
      monthSelect.value = input.month === null ? '' : String(input.month)
      if (!input.plantId) return result.replaceChildren()
      const parts: HTMLElement[] = []
      const { trace } = input
      if (trace.status === 'idle' || trace.status === 'running') {
        const pct = trace.status === 'running' ? Math.round(trace.progress * 100) : 0
        const bar = el('div', 'gardenBar')
        bar.style.setProperty('--progress', `${pct}%`)
        parts.push(withRole(el('p', 'cardBusy', `Measuring the sun over the whole area… ${pct}%`), 'status'), bar)
      } else if (trace.status === 'error') {
        parts.push(withRole(el('p', 'cardVerdict warn', trace.message), 'alert'), button('Try again', options.onRetryTrace))
      } else {
        if (input.needsClimate && input.weather === 'error') {
          parts.push(
            withRole(el('p', 'cardVerdict warn', 'Local temperatures could not be loaded (NASA POWER). Outdoor spots cannot be rated without them, so they are not coloured.'), 'alert'),
            button('Retry the temperatures', options.onRetryClimate),
          )
        } else if (input.needsClimate && input.weather !== 'ready') {
          parts.push(withRole(el('p', 'cardBusy', 'Loading local temperatures…'), 'status'))
        }
        const legend = el('div', 'findLegend')
        legend.setAttribute('aria-label', 'Colours of the plant map')
        legend.append(swatch(cssColor(STEP_COLORS[2]), 'Good'), swatch(cssColor(STEP_COLORS[1]), 'OK'), swatch(null, 'Poor: not coloured'))
        parts.push(legend)
        if (input.summary) parts.push(withRole(el('p', 'findSummary', input.summary), 'status'))
        if (input.stats.length > 0) {
          const list = el('ul', 'findCounts')
          for (const s of input.stats) {
            const li = el('li')
            li.append(el('strong', '', `${KIND_WORD[s.kind]}: `), `${s.good} good, ${s.ok} OK of ${s.total} spots`)
            list.append(li)
          }
          parts.push(list)
        }
        if (input.canShowBest) parts.push(button('Show the best spot', options.onBest))
      }
      if (input.note) parts.push(el('p', 'cardNote small', input.note))
      result.replaceChildren(...parts)
      if (keepFocus instanceof HTMLElement) keepFocus.focus()
    },
  }
}
