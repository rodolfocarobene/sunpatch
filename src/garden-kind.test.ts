import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/nasa-power-milan.json'
import { rankPlants } from './garden'
import { bestOfKind, filterByKind, getKindFilter, isKindFilter, setKindFilter } from './garden-kind'
import { parseClimate } from './weather'

const ranked = rankPlants({ indoor: false, sunMinutes: Array(12).fill(420) }, parseClimate(fixture))

describe('kind filter', () => {
  it('keeps everything for all, and only one kind otherwise, in rank order', () => {
    expect(filterByKind(ranked, 'all')).toBe(ranked)
    const herbs = filterByKind(ranked, 'herb')
    expect(herbs.length).toBeGreaterThan(0)
    expect(herbs.every((r) => r.plant.kind === 'herb')).toBe(true)
    expect(herbs).toEqual(ranked.filter((r) => r.plant.kind === 'herb'))
  })
  it('finds the best non-poor plant of a kind', () => {
    const best = bestOfKind(ranked, 'flower')
    expect(best?.plant.kind).toBe('flower')
    expect(best?.rating).not.toBe('poor')
    expect(bestOfKind([], 'all')).toBeUndefined()
  })
  it('validates and remembers the choice', () => {
    expect(isKindFilter('herb')).toBe(true)
    expect(isKindFilter('tree')).toBe(false)
    setKindFilter('fruit')
    expect(getKindFilter()).toBe('fruit')
    setKindFilter('all')
  })
})
