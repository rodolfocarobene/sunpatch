import { buildingLine } from './building-line'
import { freeBand, popoverTop } from './popover-place'
import { FLOOR_M, heightIn, overrideFor, validHeight, type HeightOverride } from './heights'
import type { Building } from './osm'

type Unit = 'floors' | 'm'

const GAP = 12
const WIDTH = 272

/** What the form shows for a building: the title, the line under it, and whether the height is the user's own. */
export function heightHeading(b: Building): { title: string; now: string; mine: boolean } {
  const line = buildingLine(b)
  const was = b.dataHeight ? `The data had ${Math.round(b.dataHeight.height * 10) / 10} m (${b.dataHeight.heightSource === 'default' ? 'a guess' : 'from OpenStreetMap'}).` : ''
  const now = [`${Math.round(b.height * 10) / 10} m`, line.source].filter(Boolean).join(' · ')
  return { title: line.title ? `${line.title} · ${line.label}` : line.label, now: was ? `${now}. ${was}` : now, mine: b.heightSource === 'user' }
}

/** The metres a typed value makes, as a short sentence under the field ("3 floors x 3 m = 9 m"); empty when it is not usable. */
export function conversion(b: Building, value: number, unit: Unit): string {
  if (!validHeight(value, unit)) return ''
  const { height } = overrideFor(b, value, unit)
  return unit === 'floors' ? `${value} ${value === 1 ? 'floor' : 'floors'} × ${FLOOR_M} m = ${Math.round((height - b.minHeight) * 10) / 10} m${b.minHeight > 0 ? ` above ${b.minHeight} m` : ''}` : `about ${Math.round((value - b.minHeight) / FLOOR_M * 10) / 10} floors`
}

export interface HeightPopover {
  /** Opens the form for `b` next to the screen point. */
  open(b: Building, at: { x: number; y: number }): void
  hide(): void
  readonly isOpen: boolean
}

export interface HeightPopoverHandlers {
  onApply(id: string, override: HeightOverride): void
  onReset(id: string): void
}

/**
 * The "Height" box that a right-click on a building, or the building line's Edit height button, opens: one number in
 * floors or metres, and a Reset when the height is the user's own. It stays where it opened; a press anywhere else,
 * Esc or its close button closes it.
 */
export function createHeightPopover(container: HTMLElement, handlers: HeightPopoverHandlers): HeightPopover {
  const box = document.createElement('form')
  box.id = 'heightPopover'
  box.hidden = true
  box.setAttribute('role', 'dialog')
  box.setAttribute('aria-label', 'Building height')
  box.noValidate = true
  box.innerHTML = `
    <button type="button" class="spotClose" aria-label="Close" title="Close (Esc)">
      <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
    </button>
    <strong class="spotHead"></strong>
    <span class="spotDetail hpNow"></span>
    <div class="hpRow">
      <label>Height <input class="hpValue" type="number" inputmode="decimal" min="1" step="1"></label>
      <select class="hpUnit" aria-label="Unit"><option value="floors">floors</option><option value="m">metres</option></select>
      <button type="submit" class="primary">Set</button>
    </div>
    <span class="spotDetail hpSum"></span>
    <span class="hpError" role="alert"></span>
    <button type="button" class="hpReset">Reset to the data</button>`
  container.appendChild(box)
  const q = <T extends HTMLElement>(sel: string) => box.querySelector<T>(sel)!
  const input = q<HTMLInputElement>('.hpValue')
  const unit = q<HTMLSelectElement>('.hpUnit')
  const error = q('.hpError')
  const reset = q<HTMLButtonElement>('.hpReset')
  let target: Building | undefined

  function hide() {
    box.hidden = true
    target = undefined
  }
  const unitNow = (): Unit => (unit.value === 'm' ? 'm' : 'floors')
  const refreshSum = () => {
    error.textContent = ''
    q('.hpSum').textContent = target ? conversion(target, input.valueAsNumber, unitNow()) : ''
  }
  const fill = () => {
    if (!target) return
    const u = unitNow()
    input.step = u === 'm' ? '0.5' : '1'
    input.value = String(heightIn(target, u))
    refreshSum()
  }
  unit.addEventListener('change', fill)
  input.addEventListener('input', refreshSum)
  q('.spotClose').addEventListener('click', hide)
  reset.addEventListener('click', () => {
    if (!target) return
    const id = target.id
    hide()
    handlers.onReset(id)
  })
  box.addEventListener('submit', (e) => {
    e.preventDefault()
    if (!target) return
    const value = input.valueAsNumber
    if (!validHeight(value, unitNow())) {
      error.textContent = unitNow() === 'floors' ? 'Enter a whole number of floors, 1 or more.' : 'Enter a height in metres, above 0.'
      return
    }
    const id = target.id
    const override = overrideFor(target, value, unitNow())
    hide()
    handlers.onApply(id, override)
  })
  // The scene is under this box: its own clicks and keys are not for the scene.
  for (const type of ['pointerdown', 'click', 'dblclick', 'contextmenu'] as const) box.addEventListener(type, (e) => e.stopPropagation())
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (!box.hidden && !box.contains(e.target as Node)) hide()
    },
    true,
  )
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      hide()
    }
  })

  return {
    open(b, at) {
      target = b
      const { title, now, mine } = heightHeading(b)
      q('.spotHead').textContent = title
      q('.hpNow').textContent = now
      reset.hidden = !mine
      unit.value = 'floors'
      fill()
      box.hidden = false
      const left = Math.min(window.innerWidth - WIDTH / 2 - 8, Math.max(WIDTH / 2 + 8, at.x))
      const { minTop, maxBottom } = freeBand()
      box.style.left = `${left}px`
      box.style.top = `${popoverTop(at.y, box.offsetHeight, GAP, minTop, maxBottom)}px`
      input.focus()
      input.select()
    },
    hide,
    get isOpen() {
      return !box.hidden
    },
  }
}

/** A line of text that follows the pointer over a building: its name or id, its height and where that came from. */
export function createHoverTip(container: HTMLElement) {
  const tip = document.createElement('div')
  tip.id = 'hoverTip'
  tip.hidden = true
  tip.setAttribute('role', 'status')
  container.appendChild(tip)
  return {
    show(lines: string[], at: { x: number; y: number }) {
      const text = lines.join('\n')
      if (tip.textContent !== text) {
        tip.replaceChildren(...lines.map((l, i) => Object.assign(document.createElement(i === 0 ? 'strong' : 'span'), { textContent: l })))
      }
      tip.hidden = false
      const w = tip.offsetWidth
      const h = tip.offsetHeight
      tip.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, at.x + 14))}px`
      tip.style.top = `${Math.max(8, Math.min(window.innerHeight - h - 8, at.y + 18))}px`
    },
    hide() {
      tip.hidden = true
    },
  }
}
