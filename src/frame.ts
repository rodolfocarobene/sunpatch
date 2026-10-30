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

/** Ground shown beyond the building's walls when the Garden view frames it, metres. */
export const GARDEN_MARGIN = 4

/**
 * Radius the Garden framing must hold: the apartment, the building's walls and a margin of ground around them (a very
 * large building is cut at about two apartment widths so the apartment stays a useful size), plus the roof when the
 * floors above are shown (`roofRise` metres above the framed floor).
 */
export function gardenRadius(apartmentRadius: number, buildingReach: number, roofRise = 0): number {
  const flat = Math.max(apartmentRadius, Math.min(buildingReach, apartmentRadius * 1.8 + 3)) + GARDEN_MARGIN
  return Math.hypot(flat, roofRise / 2)
}

/** Whether a screen point sits inside the part the left panel leaves free, `pad` pixels in from every edge. */
export function inFreeArea(x: number, y: number, width: number, height: number, insetLeft: number, pad = 48): boolean {
  return x >= insetLeft + pad && x <= width - pad && y >= pad && y <= height - pad
}
