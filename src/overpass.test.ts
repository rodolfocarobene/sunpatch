import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearOverpassCache, fetchBuildingElements } from './overpass'

const EPS = ['https://a/x', 'https://b/x', 'https://c/x']
const el = { type: 'way', id: 1 }
const ok = (body: object) => new Response(JSON.stringify(body), { status: 200 })
const opts = (fetchFn: unknown, extra = {}) => ({ fetchFn: fetchFn as typeof fetch, endpoints: EPS, ...extra })

beforeEach(clearOverpassCache)

describe('fetchBuildingElements', () => {
  it('returns the first endpoint that answers', async () => {
    const f = vi.fn().mockResolvedValue(ok({ elements: [el] }))
    expect(await fetchBuildingElements(45, 9, opts(f))).toEqual([el])
    expect(f).toHaveBeenCalledTimes(1)
    expect(f.mock.calls[0][0]).toBe(EPS[0])
  })

  it('falls through network errors, 429, 5xx and runtime-error remarks in order', async () => {
    const f = vi.fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(ok({ elements: [el] }))
    expect(await fetchBuildingElements(45, 9, opts(f))).toEqual([el])
    expect(f.mock.calls.map((c) => c[0])).toEqual(EPS.slice(0, 3))

    clearOverpassCache()
    const g = vi.fn()
      .mockResolvedValueOnce(ok({ elements: [], remark: 'runtime error: Query timed out' }))
      .mockResolvedValueOnce(new Response('', { status: 504 }))
      .mockResolvedValueOnce(ok({ elements: [el] }))
    expect(await fetchBuildingElements(45, 9, opts(g))).toEqual([el])
  })

  it('accepts an empty result without a remark', async () => {
    const f = vi.fn().mockResolvedValue(ok({ elements: [] }))
    expect(await fetchBuildingElements(45, 9, opts(f))).toEqual([])
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('moves on when an endpoint hangs past the timeout', async () => {
    const f = vi.fn().mockImplementationOnce((_u: string, init: RequestInit) =>
      new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted')))),
    ).mockResolvedValueOnce(ok({ elements: [el] }))
    expect(await fetchBuildingElements(45, 9, opts(f, { timeoutMs: 20 }))).toEqual([el])
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('throws a readable error when every endpoint fails', async () => {
    const f = vi.fn().mockResolvedValue(new Response('', { status: 503 }))
    await expect(fetchBuildingElements(45, 9, opts(f))).rejects.toThrow(/unavailable.*HTTP 503/)
    expect(f).toHaveBeenCalledTimes(3)
  })

  it('stops as soon as the caller aborts', async () => {
    const ctl = new AbortController()
    const f = vi.fn().mockImplementation(async () => {
      ctl.abort()
      throw new Error('aborted')
    })
    await expect(fetchBuildingElements(45, 9, opts(f, { signal: ctl.signal }))).rejects.toThrow()
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('reuses a cached result within 100 m, not beyond', async () => {
    const f = vi.fn().mockImplementation(async () => ok({ elements: [el] }))
    await fetchBuildingElements(45, 9, opts(f))
    await fetchBuildingElements(45.0005, 9, opts(f)) // ~55 m north
    expect(f).toHaveBeenCalledTimes(1)
    await fetchBuildingElements(45.002, 9, opts(f)) // ~222 m
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('queries the radius asked for plus the reuse margin', async () => {
    const f = vi.fn().mockImplementation(async () => ok({ elements: [el] }))
    await fetchBuildingElements(45, 9, opts(f, { radiusM: 150 }))
    expect(String(f.mock.calls[0][1].body)).toContain('around%3A250%2C')
  })

  it('serves a smaller size from a bigger answer, and fetches again for a bigger size', async () => {
    const f = vi.fn().mockImplementation(async () => ok({ elements: [el] }))
    await fetchBuildingElements(45, 9, opts(f, { radiusM: 500 }))
    await fetchBuildingElements(45, 9, opts(f, { radiusM: 150 }))
    await fetchBuildingElements(45.002, 9, opts(f, { radiusM: 350 })) // ~222 m away: 222 + 350 <= 600
    expect(f).toHaveBeenCalledTimes(1)
    clearOverpassCache()
    await fetchBuildingElements(45, 9, opts(f, { radiusM: 150 }))
    await fetchBuildingElements(45, 9, opts(f, { radiusM: 350 }))
    expect(f).toHaveBeenCalledTimes(3)
  })
})
