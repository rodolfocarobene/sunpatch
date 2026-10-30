import { FLOOR_M, MAX_FLOORS, MAX_HEIGHT_M, overrideFor, type HeightOverride } from './heights'
import type { Building } from './osm'
import { buildingName } from './building-line'
import { fmt1, t } from './i18n'

/** The finer step with Shift held, in metres. */
export const FINE_M = 0.5
/** A press that moves less than this (pixels) is a click on the handle, not a drag: nothing changes. */
export const DRAG_DEAD_PX = 3
/** Floors drawn above the roof on the ruler, so there is room to go up. */
const HEADROOM_FLOORS = 6

const round1 = (v: number) => Math.round(v * 10) / 10

/** The height a raw value snaps to: whole floors above `minHeight` (at least one), or 0.5 m steps with `fine`. */
export function snapHeight(raw: number, minHeight: number, fine: boolean): number {
  if (fine) {
    const steps = Math.max(1, Math.round((raw - minHeight) / FINE_M))
    return Math.min(MAX_HEIGHT_M, minHeight + steps * FINE_M)
  }
  const most = Math.min(MAX_FLOORS, Math.max(1, Math.floor((MAX_HEIGHT_M - minHeight) / FLOOR_M)))
  return minHeight + Math.min(most, Math.max(1, Math.round((raw - minHeight) / FLOOR_M))) * FLOOR_M
}

/** The height a handle dragged `dyPx` pixels up (negative: down) from `startHeight` makes; `pxPerM` is the screen size of a metre at the roof. */
export function heightFromDrag(startHeight: number, minHeight: number, dyPx: number, pxPerM: number, fine: boolean): number {
  if (!(pxPerM > 0)) return startHeight
  return snapHeight(startHeight + dyPx / pxPerM, minHeight, fine)
}

/** The height an arrow key makes from `height`: the next whole floor up or down (counted from where the building starts), or 0.5 m with `fine`. */
export function keyHeight(height: number, minHeight: number, dir: 1 | -1, fine: boolean): number {
  if (fine) return snapHeight(height + dir * FINE_M, minHeight, true)
  const floors = (height - minHeight) / FLOOR_M
  const next = dir > 0 ? Math.floor(floors + 1e-6) + 1 : Math.ceil(floors - 1e-6) - 1
  return snapHeight(minHeight + next * FLOOR_M, minHeight, false)
}

/** "8 floors · 24 m": the floors above where the building starts, then the top above the ground. */
export function rulerLabel(height: number, minHeight: number): string {
  const floors = round1((height - minHeight) / FLOOR_M)
  return t('hr.label', { n: floors, h: fmt1(height) })
}

/** The override a ruler height makes: whole floors are stored as floors (the apartment gets that many storeys), 0.5 m steps as metres. */
export function overrideFromRuler(b: Building, height: number): HeightOverride {
  const floors = (height - b.minHeight) / FLOOR_M
  return Math.abs(floors - Math.round(floors)) < 1e-6 ? overrideFor(b, Math.round(floors), 'floors') : overrideFor(b, height, 'm')
}

/** Where the ruler stands on screen (pixels): the roof corner nearest the camera, its base, and the size of a metre there. */
export interface RulerAnchor {
  x: number
  yBase: number
  yTop: number
  pxPerM: number
}

export interface HeightRulerHandlers {
  /** The building and its anchor now, or null when it is gone, hidden or too far to draw a ruler on. */
  resolve(id: string, near: { x: number; y: number }): { building: Building; anchor: RulerAnchor } | null
  /** Shows the building at `height` without rebuilding anything; null puts it back. */
  onPreview(id: string, height: number | null): void
  onCommit(id: string, override: HeightOverride): void
}

export interface HeightRuler {
  /** The pointer is over this building: stand the ruler on it. */
  follow(b: Building, at: { x: number; y: number }): void
  /** The pointer left the building: the ruler goes after a short grace (time to reach it), unless it is being used. */
  release(): void
  hide(): void
  readonly dragging: boolean
}

const GRACE_MS = 600
const SWITCH_MS = 300
const EDGE_PAD = 24

/**
 * A vertical ruler with a floor tick for every 3 m, standing at the roof corner nearest the pointer, on the building under it.
 * Dragging its handle changes that building's height live (whole floors, Shift for 0.5 m); the building is only
 * previewed while the handle moves, and the new height is committed when it is let go. Esc puts it back.
 */
export function createHeightRuler(container: HTMLElement, handlers: HeightRulerHandlers): HeightRuler {
  const box = document.createElement('div')
  box.id = 'heightRuler'
  box.hidden = true
  box.setAttribute('role', 'group')
  box.setAttribute('aria-label', t('hr.aria'))
  box.innerHTML = `
    <div class="hrTrack"></div>
    <div class="hrTicks" aria-hidden="true"></div>
    <div class="hrHandle" role="slider" tabindex="0" aria-orientation="vertical" title="${t('hr.handle')}"><span class="hrGrip" aria-hidden="true"></span></div>
    <output class="hrLabel"></output>`
  container.appendChild(box)
  const track = box.querySelector<HTMLElement>('.hrTrack')!
  const ticks = box.querySelector<HTMLElement>('.hrTicks')!
  const handle = box.querySelector<HTMLElement>('.hrHandle')!
  const label = box.querySelector<HTMLOutputElement>('.hrLabel')!

  let target: { id: string; building: Building; anchor: RulerAnchor } | undefined
  let drag: { startY: number; height: number; moved: boolean } | undefined
  let timer = 0
  let switchTimer = 0
  let last = { x: 0, y: 0 }
  let inside = false
  let pointer = { x: 0, y: 0 }
  /** A height typed with the arrow keys, previewed until Enter or blur commits it. */
  let keyed: number | undefined

  const yFor = (height: number) => target!.anchor.yBase - (height - target!.building.minHeight) * target!.anchor.pxPerM

  function layout(height: number) {
    if (!target) return
    const { anchor, building } = target
    const topY = Math.max(EDGE_PAD, Math.min(yFor(height), yFor(building.height)) - HEADROOM_FLOORS * FLOOR_M * anchor.pxPerM)
    box.style.left = `${Math.min(window.innerWidth - 200, Math.max(EDGE_PAD, anchor.x))}px`
    track.style.top = `${topY}px`
    track.style.height = `${Math.max(0, anchor.yBase - topY)}px`
    // Floor ticks; when floors get closer than 5 px only every few are drawn.
    const every = Math.max(1, Math.ceil(5 / (FLOOR_M * anchor.pxPerM)))
    const frag = document.createDocumentFragment()
    const floorsUp = Math.ceil((anchor.yBase - topY) / (FLOOR_M * anchor.pxPerM))
    for (let n = 0; n <= floorsUp; n += every) {
      const y = anchor.yBase - n * FLOOR_M * anchor.pxPerM
      if (y < topY - 1 || y > window.innerHeight + 20) continue
      const t = document.createElement('i')
      t.style.top = `${y}px`
      if (building.minHeight + n * FLOOR_M > building.height + 1e-6) t.className = 'above'
      frag.appendChild(t)
    }
    ticks.replaceChildren(frag)
    place(height)
  }
  function place(height: number) {
    if (!target) return
    const y = Math.max(EDGE_PAD, yFor(height))
    handle.style.top = `${y}px`
    label.style.top = `${y}px`
    label.textContent = rulerLabel(height, target.building.minHeight)
    box.classList.toggle('active', drag?.moved === true)
    const floors = round1((height - target.building.minHeight) / FLOOR_M)
    handle.setAttribute('aria-valuemin', String(round1(target.building.minHeight + FINE_M)))
    handle.setAttribute('aria-valuemax', String(MAX_HEIGHT_M))
    handle.setAttribute('aria-valuenow', String(round1(height)))
    handle.setAttribute('aria-valuetext', t('hr.label', { n: floors, h: fmt1(height) }).replace(' · ', ', '))
    handle.setAttribute('aria-label', t('hr.handleAria', { name: buildingName(target.building) }))
  }

  function show(id: string): boolean {
    const resolved = handlers.resolve(id, pointer)
    if (!resolved) {
      hide()
      return false
    }
    target = { id, ...resolved }
    box.hidden = false
    layout(resolved.building.height)
    return true
  }
  function hide() {
    commitKeyed()
    clearTimeout(timer)
    clearTimeout(switchTimer)
    if (drag && target) handlers.onPreview(target.id, null)
    drag = undefined
    box.hidden = true
    box.classList.remove('active')
    target = undefined
    inside = false
  }

  /** Enter or blur: the keyed height goes in as a mouse release would. */
  function commitKeyed() {
    if (keyed === undefined || !target) return void (keyed = undefined)
    const { id, building } = target
    const height = keyed
    keyed = undefined
    handlers.onPreview(id, null)
    if (height === building.height) return layout(building.height)
    handlers.onCommit(id, overrideFromRuler(building, height))
    show(id)
  }
  function cancelKeyed() {
    if (keyed === undefined || !target) return
    keyed = undefined
    handlers.onPreview(target.id, null)
    layout(target.building.height)
  }
  handle.addEventListener('keydown', (e) => {
    if (!target || drag) return
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      e.stopPropagation()
      keyed = keyHeight(keyed ?? target.building.height, target.building.minHeight, e.key === 'ArrowUp' ? 1 : -1, e.shiftKey)
      place(keyed)
      handlers.onPreview(target.id, keyed)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      commitKeyed()
    } else if (e.key === 'Escape' && keyed !== undefined) {
      e.preventDefault()
      e.stopPropagation()
      cancelKeyed()
    }
  })
  handle.addEventListener('blur', () => {
    commitKeyed()
    if (!inside && !drag && !box.hidden) timer = window.setTimeout(hide, GRACE_MS)
  })
  const focused = () => handle.matches(':focus')

  handle.addEventListener('pointerdown', (e) => {
    if (!target || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    handle.setPointerCapture(e.pointerId)
    drag = { startY: e.clientY, height: target.building.height, moved: false }
  })
  handle.addEventListener('pointermove', (e) => {
    if (!drag || !target) return
    const dy = drag.startY - e.clientY
    if (!drag.moved && Math.abs(dy) < DRAG_DEAD_PX) return
    drag.moved = true
    last = { x: e.clientX, y: e.clientY }
    const { building, anchor } = target
    drag.height = heightFromDrag(building.height, building.minHeight, dy, anchor.pxPerM, e.shiftKey)
    place(drag.height)
    handlers.onPreview(target.id, drag.height)
  })
  const finish = (commit: boolean) => {
    if (!drag || !target) return
    const { height, moved } = drag
    const { id, building } = target
    drag = undefined
    handlers.onPreview(id, null)
    if (commit && moved && height !== building.height) {
      handlers.onCommit(id, overrideFromRuler(building, height))
      pointer = { x: last.x - 48, y: last.y } // stand where the handle was let go, with the new height, ready to go on
      if (!show(id)) return
    } else layout(building.height)
    clearTimeout(timer) // the commit rebuilt the scene, which reported the pointer off the building
    if (!handle.matches(':hover') && !focused()) timer = window.setTimeout(hide, GRACE_MS)
  }
  handle.addEventListener('pointerup', () => finish(true))
  handle.addEventListener('pointercancel', () => finish(false))
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && drag) {
        e.stopPropagation()
        finish(false)
      }
    },
    true,
  )

  box.addEventListener('pointerenter', () => {
    inside = true
    clearTimeout(timer)
    clearTimeout(switchTimer)
  })
  box.addEventListener('pointerleave', () => {
    inside = false
    if (!drag && !focused()) timer = window.setTimeout(hide, GRACE_MS)
  })
  // The scene is under the ruler: its own clicks and menus are not for the scene.
  for (const type of ['click', 'dblclick', 'contextmenu'] as const) box.addEventListener(type, (e) => e.stopPropagation())
  // A press anywhere else starts an orbit or a click; the camera is about to move, so the ruler goes.
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (!box.hidden && !box.contains(e.target as Node)) hide()
    },
    true,
  )
  window.addEventListener('wheel', () => { if (!drag) hide() }, { passive: true, capture: true })

  return {
    follow(b, at) {
      clearTimeout(timer)
      if (drag) return
      // Once standing on a building the ruler stays where it is, so the pointer can travel to it. Crossing another
      // building on the way does not move it: that one only gets the ruler when the pointer rests on it.
      if (!box.hidden && target?.id === b.id) return clearTimeout(switchTimer)
      clearTimeout(switchTimer)
      pointer = at
      if (box.hidden) show(b.id)
      else switchTimer = window.setTimeout(() => show(b.id), SWITCH_MS)
    },
    release() {
      clearTimeout(switchTimer)
      if (drag || inside || box.hidden || focused()) return
      clearTimeout(timer)
      timer = window.setTimeout(hide, GRACE_MS)
    },
    hide,
    get dragging() {
      return drag !== undefined
    },
  }
}
