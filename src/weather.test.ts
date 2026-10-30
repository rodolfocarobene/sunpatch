import { beforeEach, describe, expect, it } from 'vitest'
import fixture from '../fixtures/nasa-power-milan.json'
import { clearClimateMemory, loadClimate, parseClimate } from './weather'

const KEY = 'sunpatch.nasaPower.v2'

describe('NASA POWER temperatures', () => {
  const c = parseClimate(fixture)

  it('reads 12 monthly values of each temperature', () => {
    for (const a of [c.tMean, c.tMin, c.tMax, c.tLow]) expect(a).toHaveLength(12)
    expect(c.tMean[0]).toBeCloseTo(2.74, 2)
    expect(c.tMean[6]).toBeCloseTo(24.07, 2)
  })

  it('derives the typical daily minimum and maximum from the mean daily range', () => {
    expect(c.tMin[6]).toBeCloseTo(24.07 - 10.06 / 2, 2)
    expect(c.tMax[6]).toBeCloseTo(24.07 + 10.06 / 2, 2)
    c.tMean.forEach((t, i) => {
      expect(c.tMin[i]).toBeLessThan(t)
      expect(c.tMax[i]).toBeGreaterThan(t)
      expect(c.tLow[i]).toBeLessThan(c.tMin[i])
    })
  })

  it('rejects a response without temperatures or with a fill value', () => {
    const param = (fixture as unknown as { properties: { parameter: Record<string, Record<string, number>> } }).properties.parameter
    const { T2M, ...rest } = param
    expect(() => parseClimate({ properties: { parameter: rest } })).toThrow()
    expect(() => parseClimate({ properties: { parameter: { ...param, T2M: { ...T2M, MAR: -999 } } } })).toThrow()
  })
})

describe('climate cache', () => {
  const store = new Map<string, string>()
  beforeEach(() => {
    store.clear()
    clearClimateMemory()
    ;(globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    }
  })
  const fetcher = (calls: { n: number }) =>
    (async () => {
      calls.n++
      return { ok: true, status: 200, json: async () => fixture }
    }) as unknown as typeof fetch

  it('persists the parsed climate with temperatures', async () => {
    const calls = { n: 0 }
    await loadClimate(45.5, 9.2, fetcher(calls))
    clearClimateMemory()
    const again = await loadClimate(45.5, 9.2, fetcher(calls))
    expect(calls.n).toBe(1)
    expect(again.tMean).toHaveLength(12)
  })

  it('refetches an entry that has no temperatures', async () => {
    const old = { clearness: Array(12).fill(0.7) }
    store.set(KEY, JSON.stringify({ '45.5,9.2': { at: Date.now(), climate: old } }))
    const calls = { n: 0 }
    const c = await loadClimate(45.5, 9.2, fetcher(calls))
    expect(calls.n).toBe(1)
    expect(c.tMax).toHaveLength(12)
  })
})
