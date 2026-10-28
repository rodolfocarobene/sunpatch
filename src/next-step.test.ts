import { describe, expect, it } from 'vitest'
import { nextStep } from './next-step'
import type { Plan } from './plan'

const square = (s: number) => [{ x: 0, z: 0 }, { x: s, z: 0 }, { x: s, z: s }, { x: 0, z: s }]
const footprint = { outer: square(20), holes: [] }
const plan = (outer = square(20), windows: Plan['windows'] = []): Plan => ({
  version: 1,
  buildingId: 'way/1',
  origin: { lat: 0, lon: 0 },
  floor: 0,
  floorHeight: 3,
  outline: { outer, holes: [] },
  walls: [],
  windows,
})
const win = { ring: 0, edge: 0, t: 0.5, width: 1.2, sill: 0.9, height: 1.4 }

describe('nextStep', () => {
  it('asks for the outline when there is no plan', () => {
    expect(nextStep(undefined, footprint)).toBe('outline')
  })
  it('asks for the outline while it is still the whole floor', () => {
    expect(nextStep(plan(), footprint)).toBe('outline')
  })
  it('asks for windows once the outline differs from the floor', () => {
    expect(nextStep(plan(square(10)), footprint)).toBe('windows')
  })
  it('points to the result once there is a window', () => {
    expect(nextStep(plan(square(10), [win]), footprint)).toBe('see')
    expect(nextStep(plan(square(20), [win]), footprint)).toBe('see')
  })
  it('treats a plan as whole floor when the building is unknown', () => {
    expect(nextStep(plan(), undefined)).toBe('outline')
  })
})
