import type { PerspectiveCamera } from 'three'
import type { Point } from './osm'
import type { Plan } from './plan'
import { DAY_MAX, STEP } from './daylight'
import { movePosition } from './walk-geom'

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
}

export interface WalkControls {
  readonly active: boolean
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
  setStatus(text: string): void
  /** Mirrors the panel's time: slider position, label and the day strip's CSS background. */
  setTime(minutes: number, strip: string): void
  setPlaying(playing: boolean): void
}

export interface WalkHudHandlers {
  exit(): void
  /** The slider was dragged to this many minutes of the day. */
  setMinutes(minutes: number): void
  togglePlay(): void
}

export function createWalkHud(container: HTMLElement, handlers: WalkHudHandlers): WalkHud {
  const hud = document.createElement('div')
  hud.id = 'walkHud'
  hud.hidden = true
  hud.innerHTML = `
    <div class="walkStatus"></div>
    <div class="walkTime">
      <button type="button" class="walkPlay" aria-label="Play the day" title="Play the day (P)">Play</button>
      <div class="timeTrack">
        <div class="dayStrip" aria-hidden="true"></div>
        <input class="timeRange" type="range" min="0" max="${DAY_MAX}" step="${STEP}" aria-label="Time of day">
      </div>
      <output class="walkClock"></output>
    </div>
    <div class="walkHelp">
      <span><kbd>Drag</kbd> look</span>
      <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk</span>
      <span><kbd>Shift</kbd> faster</span>
      <span><kbd>[</kbd><kbd>]</kbd> \u00b115 min</span>
      <span><kbd>P</kbd> play</span>
      <button type="button" class="walkExit">Exit walk <kbd>Esc</kbd></button>
    </div>`
  // Nothing in the HUD reaches the look-drag handlers, and the slider gives the keys back to the walk.
  for (const type of ['pointerdown', 'pointermove', 'pointerup'] as const) hud.addEventListener(type, (e) => e.stopPropagation())
  container.appendChild(hud)
  const status = hud.querySelector('.walkStatus')!
  const range = hud.querySelector<HTMLInputElement>('.timeRange')!
  const strip = hud.querySelector<HTMLElement>('.dayStrip')!
  const clock = hud.querySelector('.walkClock')!
  const playButton = hud.querySelector<HTMLButtonElement>('.walkPlay')!
  hud.querySelector('.walkExit')!.addEventListener('click', handlers.exit)
  playButton.addEventListener('click', () => {
    handlers.togglePlay()
    playButton.blur()
  })
  range.addEventListener('input', () => handlers.setMinutes(Number(range.value)))
  range.addEventListener('pointerup', () => range.blur())
  range.addEventListener('change', () => range.blur())
  return {
    show(on) {
      hud.hidden = !on
    },
    setStatus(text) {
      status.textContent = text
    },
    setTime(minutes, background) {
      range.value = String(minutes)
      clock.textContent = formatClock(minutes)
      strip.style.background = background
    },
    setPlaying(playing) {
      playButton.textContent = playing ? 'Pause' : 'Play'
      playButton.setAttribute('aria-label', playing ? 'Pause the day' : 'Play the day')
    },
  }
}

const formatClock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
