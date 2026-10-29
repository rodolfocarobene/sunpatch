/**
 * Top edge for a popover next to the point at height `y`: above it if that fits under `minTop`, else below it
 * if that ends above `maxBottom`, else pushed into the free band between the two (it may then cover the point).
 */
export function popoverTop(y: number, height: number, gap: number, minTop: number, maxBottom: number): number {
  if (y - height - gap >= minTop) return y - height - gap
  if (y + gap + height <= maxBottom) return y + gap
  return Math.max(minTop, Math.min(y - height - gap, maxBottom - height))
}

/** The free vertical band on screen: below the compass (when shown) and above the docked time bar (when shown). */
export function freeBand(): { minTop: number; maxBottom: number } {
  const rect = (id: string) => {
    const el = document.getElementById(id)
    return el && !el.hidden ? el.getBoundingClientRect() : null
  }
  const compass = rect('walkCompass')
  const dock = rect('dock')
  return {
    minTop: compass ? compass.bottom + 8 : 8,
    maxBottom: (dock ? dock.top : window.innerHeight) - 8,
  }
}
