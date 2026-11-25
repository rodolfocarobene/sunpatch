/** A pointer press and release this close (in pixels) is a click; further apart it was a drag (orbit, pan). */
export const CLICK_MAX_MOVE_PX = 5

export function isClick(down: { x: number; y: number } | undefined, up: { x: number; y: number }, max = CLICK_MAX_MOVE_PX): boolean {
  return !down || Math.hypot(up.x - down.x, up.y - down.y) <= max
}

/** Where the current press began, or a point infinitely far away when a second finger joined it (a pinch or two-finger pan is never a click). */
export interface PressTracker {
  down(id: number, x: number, y: number): void
  up(id: number): void
  /** Forgets every pointer (a mouse press never overlaps a stuck touch). */
  reset(): void
  readonly start: { x: number; y: number } | undefined
}

export function createPressTracker(): PressTracker {
  const active = new Set<number>()
  let start: { x: number; y: number } | undefined
  return {
    down(id, x, y) {
      active.add(id)
      start = active.size > 1 ? { x: Infinity, y: Infinity } : { x, y }
    },
    up: (id) => void active.delete(id),
    reset: () => active.clear(),
    get start() {
      return start
    },
  }
}
