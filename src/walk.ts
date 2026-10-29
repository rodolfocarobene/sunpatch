import type { PerspectiveCamera } from 'three'
import type { Point } from './osm'
import type { Plan } from './plan'
import type { SunDirection } from './sun'
import { bandMarker, headingDeg, movePosition, relativeBearing } from './walk-geom'

export const EYE_HEIGHT = 1.6
const WALK_SPEED = 1.4
const RUN_FACTOR = 2
const LOOK_SENSITIVITY = 0.004
const MAX_PITCH = (85 * Math.PI) / 180
const MAX_FRAME_DELTA = 0.25

export interface WalkHandlers {
  exit(): void
  stepTime(minutes: number): void
  togglePlay(): void
  /** The H key: show or hide the floors above. */
  toggleCutaway(): void
  /** The M key: switch the sun map on or off. */
  toggleSunMap(): void
  /** Every frame while walking, with the look direction (the HUD compass). */
  look?(yaw: number): void
}

export interface WalkControls {
  readonly active: boolean
  /** Where the camera looks, radians counter-clockwise from north. */
  readonly yaw: number
  /** Stands at `at` (scene x, z) on a floor whose surface is at height `floorY`, looking along `yaw`. */
  start(plan: Plan, floorY: number, at: Point, yaw: number): void
  stop(): void
  /** Applies held keys for `dt` seconds. */
  update(dt: number): void
}

function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(TEXTAREA|SELECT)$/.test(target.tagName) || (target instanceof HTMLInputElement && target.type !== 'range'))
}

export function createWalkControls(camera: PerspectiveCamera, dom: HTMLElement, handlers: WalkHandlers): WalkControls {
  camera.rotation.order = 'YXZ'
  let active = false
  let plan: Plan
  let floorY = 0
  let pos: Point = { x: 0, z: 0 }
  let yaw = 0
  let pitch = 0
  let dragging = false
  let shiftHeld = false
  const held = new Set<string>()

  function place() {
    camera.position.set(pos.x, floorY + EYE_HEIGHT, pos.z)
    camera.rotation.set(pitch, yaw, 0)
  }

  const MOVES: Record<string, 'forward' | 'back' | 'left' | 'right'> = {
    KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back',
    KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  }

  function onKeyDown(e: KeyboardEvent) {
    shiftHeld = e.shiftKey
    if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return
    if (e.key === 'Escape') handlers.exit()
    else if (e.key === '[' || e.code === 'BracketLeft') handlers.stepTime(-15)
    else if (e.key === ']' || e.code === 'BracketRight') handlers.stepTime(15)
    else if (e.code === 'KeyP') handlers.togglePlay()
    else if (e.code === 'KeyH') handlers.toggleCutaway()
    else if (e.code === 'KeyM') handlers.toggleSunMap()
    else if (MOVES[e.code]) held.add(MOVES[e.code])
    else return
    e.preventDefault()
  }
  function onKeyUp(e: KeyboardEvent) {
    shiftHeld = e.shiftKey
    const move = MOVES[e.code]
    if (move) held.delete(move)
  }
  const clearKeys = () => {
    held.clear()
    shiftHeld = false
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return
    dragging = true
    dom.setPointerCapture?.(e.pointerId)
    // Leaves a focused panel input so the keys reach the walk controls.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  }
  function onPointerMove(e: PointerEvent) {
    if (!dragging) return
    yaw -= e.movementX * LOOK_SENSITIVITY
    pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch - e.movementY * LOOK_SENSITIVITY))
    place()
  }
  const onPointerUp = () => { dragging = false }

  return {
    get active() {
      return active
    },
    get yaw() {
      return yaw
    },
    start(p, y, at, direction) {
      plan = p
      floorY = y
      pos = at
      yaw = direction
      pitch = 0
      active = true
      held.clear()
      place()
      window.addEventListener('keydown', onKeyDown)
      window.addEventListener('keyup', onKeyUp)
      window.addEventListener('blur', clearKeys)
      dom.addEventListener('pointerdown', onPointerDown)
      dom.addEventListener('pointermove', onPointerMove)
      dom.addEventListener('pointerup', onPointerUp)
      dom.addEventListener('pointercancel', onPointerUp)
    },
    stop() {
      active = false
      dragging = false
      held.clear()
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', clearKeys)
      dom.removeEventListener('pointerdown', onPointerDown)
      dom.removeEventListener('pointermove', onPointerMove)
      dom.removeEventListener('pointerup', onPointerUp)
      dom.removeEventListener('pointercancel', onPointerUp)
    },
    update(dt) {
      if (!active) return
      const forward = Number(held.has('forward')) - Number(held.has('back'))
      const right = Number(held.has('right')) - Number(held.has('left'))
      if (forward || right) {
        const sprint = shiftHeld ? RUN_FACTOR : 1
        const length = Math.hypot(forward, right)
        const step = (WALK_SPEED * sprint * Math.min(dt, MAX_FRAME_DELTA)) / length
        // Forward is (-sin yaw, -cos yaw), right is (cos yaw, -sin yaw) in (x, z).
        const dx = (-Math.sin(yaw) * forward + Math.cos(yaw) * right) * step
        const dz = (-Math.cos(yaw) * forward - Math.sin(yaw) * right) * step
        pos = movePosition(plan, pos, { x: pos.x + dx, z: pos.z + dz })
      }
      place()
    },
  }
}

export interface WalkHud {
  show(on: boolean): void
  /** The sun for the compass band; called whenever the date or time changes. */
  setSun(sun: SunDirection): void
  /** The look direction (walk yaw) for the compass band; cheap to call every frame. */
  setYaw(yaw: number): void
}

export interface WalkHudHandlers {
  exit(): void
}

const BAND_WIDTH = 320
const BAND_INSET = 16 // the sun marker's half width: it stops this far from the end of the band
const BAND_HALF_SPAN = 90 // degrees either side of the view direction that the band maps onto its inner width
const PX_PER_DEGREE = (BAND_WIDTH / 2 - BAND_INSET) / BAND_HALF_SPAN
const CARDINALS = new Map([[0, 'N'], [45, 'NE'], [90, 'E'], [135, 'SE'], [180, 'S'], [225, 'SW'], [270, 'W'], [315, 'NW']])
const SUN_ICON =
  '<svg class="sunMark" viewBox="-10 -10 20 20" width="20" height="20" aria-hidden="true"><circle r="4.5"/>' +
  [0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<line y1="-6.5" y2="-9" transform="rotate(${a})"/>`).join('') +
  '</svg>'
const CHEVRON = (side: 'left' | 'right') =>
  `<svg class="edgeArrow" data-side="${side}" viewBox="0 0 8 12" width="8" height="12" aria-hidden="true"><path d="${side === 'left' ? 'M6.5 1 1.5 6l5 5' : 'M1.5 1l5 5-5 5'}"/></svg>`

/** Ticks every 15 degrees from -180 to 540 (so any heading shows a full band), labelled at the eight main points. */
function bandTicks(): string {
  let html = ''
  for (let a = -180; a < 540; a += 15) {
    const name = CARDINALS.get(((a % 360) + 360) % 360)
    const kind = name ? (name.length === 1 ? 'main' : 'half') : 'minor'
    html += `<i class="tick ${kind}" style="left:${(a + 180) * PX_PER_DEGREE}px">${name ? `<b>${name}</b>` : ''}</i>`
  }
  return html
}

/** `dock` is the bottom box that holds the time bar; the key hints go on top of it, the compass into `container`. */
export function createWalkHud(container: HTMLElement, dock: HTMLElement, handlers: WalkHudHandlers): WalkHud {
  const hud = document.createElement('div')
  hud.id = 'walkHud'
  hud.hidden = true
  hud.innerHTML = `
    <div class="walkHelp">
      <span><kbd>Drag</kbd> look</span>
      <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk</span>
      <span><kbd>Shift</kbd> faster</span>
      <span><kbd>[</kbd><kbd>]</kbd> \u00b115 min</span>
      <span><kbd>Click</kbd> floor for sun</span>
      <button type="button" class="walkExit">Exit walk <kbd>Esc</kbd></button>
    </div>`
  // Nothing in the HUD reaches the look-drag handlers, and the slider gives the keys back to the walk.
  for (const type of ['pointerdown', 'pointermove', 'pointerup'] as const) hud.addEventListener(type, (e) => e.stopPropagation())
  dock.prepend(hud)
  const compass = document.createElement('div')
  compass.id = 'walkCompass'
  compass.hidden = true
  compass.style.setProperty('--band', `${BAND_WIDTH}px`)
  compass.innerHTML = `
    <div class="compassBand" role="img" aria-label="Where the sun is, relative to where you look">
      <div class="compassStrip">${bandTicks()}</div>
      <span class="compassAhead"></span>
      ${CHEVRON('left')}${CHEVRON('right')}${SUN_ICON}
    </div>
    <div class="compassCaption"></div>`
  container.appendChild(compass)
  const compassStrip = compass.querySelector<HTMLElement>('.compassStrip')!
  const sunMark = compass.querySelector<SVGElement>('.sunMark')!
  const caption = compass.querySelector('.compassCaption')!
  const band = compass.querySelector<HTMLElement>('.compassBand')!
  let sunNow: SunDirection | undefined
  let yawNow: number | undefined
  let drawn = ''
  // Writes only what changed since the last frame: the strip's offset, the marker's offset and the caption.
  function drawCompass() {
    if (!sunNow || yawNow === undefined) return
    const heading = headingDeg(yawNow)
    const relative = relativeBearing(heading, sunNow.azimuthDeg)
    const marker = bandMarker(relative, BAND_HALF_SPAN)
    const stripX = Math.round((BAND_WIDTH / 2 - (heading + 180) * PX_PER_DEGREE) * 4) / 4
    const markX = Math.round(marker.offset * (BAND_WIDTH / 2 - BAND_INSET) * 4) / 4
    const up = sunNow.altitudeDeg > 0
    const text = up ? `Sun ${Math.round(sunNow.altitudeDeg)}\u00b0 up` : 'Sun below the horizon'
    const state = `${stripX}|${markX}|${marker.clamped ? Math.sign(relative) : 0}|${up}|${text}`
    if (state === drawn) return
    drawn = state
    compassStrip.style.transform = `translateX(${stripX}px)`
    sunMark.style.transform = `translateX(${markX}px)`
    band.dataset.edge = marker.clamped ? (relative < 0 ? 'left' : 'right') : ''
    band.dataset.up = String(up)
    caption.textContent = text
  }
  hud.querySelector('.walkExit')!.addEventListener('click', handlers.exit)
  return {
    show(on) {
      hud.hidden = !on
      compass.hidden = !on
      if (on) drawn = ''
    },
    setSun(sun) {
      sunNow = sun
      drawCompass()
    },
    setYaw(yaw) {
      yawNow = yaw
      drawCompass()
    },
  }
}
