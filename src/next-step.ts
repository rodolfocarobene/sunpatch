import type { Point } from './osm'
import type { Plan } from './plan'

/** What the user should do next on the apartment: draw its outline, place windows, or look at the result. */
export type NextStep = 'outline' | 'windows' | 'see'

const SAME_POINT_M = 0.05

function sameRing(a: Point[], b: Point[]): boolean {
  return a.length === b.length && a.every((p, i) => Math.hypot(p.x - b[i].x, p.z - b[i].z) < SAME_POINT_M)
}

/** True while the outline is still the default whole floor of the building (no ring edited). */
export function isWholeFloor(plan: Plan, footprint: { outer: Point[]; holes: Point[][] }): boolean {
  const { outer, holes } = plan.outline
  return sameRing(outer, footprint.outer) && holes.length === footprint.holes.length && holes.every((h, i) => sameRing(h, footprint.holes[i]))
}

/** Derived from the plan alone; there is no stored wizard state. */
export function nextStep(plan: Plan | undefined, footprint: { outer: Point[]; holes: Point[][] } | undefined): NextStep {
  if (!plan) return 'outline'
  if (plan.windows.length > 0) return 'see'
  return footprint && !isWholeFloor(plan, footprint) ? 'windows' : 'outline'
}
