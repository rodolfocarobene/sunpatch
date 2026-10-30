/** Share of the free viewport (the smaller side) that the framed apartment's bounding circle should cover. */
export const FRAME_FILL = 0.7

/**
 * How far the camera sits from a target whose bounding circle (radius in metres) should fill `fill` of the visible
 * area: `aspect` is the width over the height of that area, `fovDeg` the vertical field of view.
 */
export function fitDistance(radius: number, fovDeg: number, aspect: number, fill = FRAME_FILL): number {
  const half = Math.tan((fovDeg * Math.PI) / 360)
  return radius / (fill * half * Math.min(1, Math.max(aspect, 0.2)))
}

/** Width over height of the part of the screen the left panel leaves free. */
export function freeAspect(width: number, height: number, insetLeft: number): number {
  return Math.max(width - insetLeft, 1) / Math.max(height, 1)
}

/** Metres per pixel of the free area at `distance`: how far to slide the view so the target sits in the middle of it. */
export function metresPerPixel(distance: number, fovDeg: number, height: number): number {
  return (2 * distance * Math.tan((fovDeg * Math.PI) / 360)) / Math.max(height, 1)
}
