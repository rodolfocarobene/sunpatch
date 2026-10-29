/** A pointer press and release this close (in pixels) is a click; further apart it was a drag (orbit, pan). */
export const CLICK_MAX_MOVE_PX = 5

export function isClick(down: { x: number; y: number } | undefined, up: { x: number; y: number }, max = CLICK_MAX_MOVE_PX): boolean {
  return !down || Math.hypot(up.x - down.x, up.y - down.y) <= max
}
