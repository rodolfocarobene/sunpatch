import { describe, expect, it } from 'vitest'
import { classifyHit } from './garden-pick'

describe('classifyHit', () => {
  it('the apartment floor is indoors, whatever the height', () => {
    expect(classifyHit({ y: 6.1, apartmentFloor: true, normalY: 1 })).toBe('indoor')
  })

  it('flat ground is outdoors on the ground', () => {
    expect(classifyHit({ y: 0, apartmentFloor: false, normalY: 1 })).toBe('ground')
  })

  it('a flat surface above ground level is a roof or terrace', () => {
    expect(classifyHit({ y: 9, apartmentFloor: false, normalY: 1 })).toBe('roof')
    expect(classifyHit({ y: 3.2, apartmentFloor: false, normalY: 0.95 })).toBe('roof')
  })

  it('a facade, a ceiling or a steep surface makes no spot', () => {
    expect(classifyHit({ y: 4, apartmentFloor: false, normalY: 0 })).toBeNull()
    expect(classifyHit({ y: 3, apartmentFloor: false, normalY: -1 })).toBeNull()
    expect(classifyHit({ y: 0.1, apartmentFloor: false, normalY: 0.5 })).toBeNull()
  })
})
