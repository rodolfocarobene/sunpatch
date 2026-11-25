/** A finger held this long (milliseconds) without moving opens the context menu: a touch screen has no right-click. */
export const LONG_PRESS_MS = 500
/** A finger that moves further than this (pixels) is a drag (orbit, pan, look around), not a long press. */
export const LONG_PRESS_MOVE_PX = 10

interface PointerLike {
  pointerId: number
  pointerType?: string
  clientX: number
  clientY: number
}

export interface LongPress {
  down(e: PointerLike): void
  move(e: PointerLike): void
  /** A finger lifted or cancelled. */
  up(e: Pick<PointerLike, 'pointerId'>): void
  /** A finger is on the screen: the browser's own long-press menu event is left to this one. */
  readonly touching: boolean
  /** True once after a long press fired: the click its release makes is not a click on the scene. */
  takeClick(): boolean
}

/**
 * One finger held still for `LONG_PRESS_MS` calls `fire` with where it is. A mouse or pen press, a second finger (pinch,
 * two-finger pan), a move beyond `LONG_PRESS_MOVE_PX` or a lift before the time cancel it.
 */
export function createLongPress(
  fire: (at: { x: number; y: number }) => void,
  timers: { set: (fn: () => void, ms: number) => unknown; clear: (handle: unknown) => void } = {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
): LongPress {
  const fingers = new Set<number>()
  let start: { id: number; x: number; y: number } | undefined
  let timer: unknown
  let eatClick = false
  const cancel = () => {
    if (timer !== undefined) timers.clear(timer)
    timer = undefined
    start = undefined
  }
  return {
    down(e) {
      eatClick = false
      if (e.pointerType !== 'touch') return
      fingers.add(e.pointerId)
      cancel()
      if (fingers.size > 1) return
      const at = { id: e.pointerId, x: e.clientX, y: e.clientY }
      start = at
      timer = timers.set(() => {
        timer = undefined
        start = undefined
        eatClick = true
        fire({ x: at.x, y: at.y })
      }, LONG_PRESS_MS)
    },
    move(e) {
      if (start && e.pointerId === start.id && Math.hypot(e.clientX - start.x, e.clientY - start.y) > LONG_PRESS_MOVE_PX) cancel()
    },
    up(e) {
      fingers.delete(e.pointerId)
      if (start?.id === e.pointerId) cancel()
    },
    get touching() {
      return fingers.size > 0
    },
    takeClick() {
      const eat = eatClick
      eatClick = false
      return eat
    },
  }
}
