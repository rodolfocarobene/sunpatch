import { describe, expect, it, vi } from 'vitest'
import fixture from '../fixtures/overpass-milan-duomo.json'
import { buildExample } from './example'
import type { OverpassElement } from './osm'
import { decodeShare, encodeShare, SHARE_VERSION, type Shared } from './share'

const example = buildExample(fixture.elements as unknown as OverpassElement[])
const plan = { ...example.plan, heights: { 'way/1': { height: 15, levels: 5 } } }
const share: Shared = { lat: 45.46278, lon: 9.19104, view: '3d', date: '2026-12-21', minutes: 750, plan, example: true }

describe('share links', () => {
  it('round-trips the plan, place, date, time and tab', async () => {
    const hash = await encodeShare(share)
    expect(hash.startsWith(`#s=${SHARE_VERSION}.`)).toBe(true)
    const out = await decodeShare(hash)
    if (!('share' in out)) throw new Error(out.error)
    expect(out.share.lat).toBe(share.lat)
    expect(out.share.lon).toBe(share.lon)
    expect(out.share.date).toBe(share.date)
    expect(out.share.minutes).toBe(750)
    expect(out.share.view).toBe('3d')
    expect(out.share.example).toBe(true)
    expect(out.share.plan.buildingId).toBe(plan.buildingId)
    expect(out.share.plan.floor).toBe(plan.floor)
    expect(out.share.plan.heights).toEqual(plan.heights)
    expect(out.share.plan.windows).toEqual(plan.windows.map((w) => ({ ...w, t: Math.round(w.t * 1000) / 1000 })))
    // everything is kept to a millimetre
    expect(out.share.plan.outline.outer[0].x).toBeCloseTo(plan.outline.outer[0].x, 2)
  })

  it('keeps the Milan example link short', async () => {
    const hash = await encodeShare(share)
    console.log('Milan example share hash length:', hash.length)
    expect(hash.length).toBeLessThan(2000)
  })

  it('is a plain link (no example flag) when not made from the example', async () => {
    const out = await decodeShare(await encodeShare({ ...share, example: undefined }))
    expect('share' in out && out.share.example).toBeFalsy()
  })

  it('writes a longer plain link without compression support, which opens everywhere', async () => {
    const hash = await encodeShare(share)
    vi.stubGlobal('CompressionStream', undefined)
    try {
      const plain = await encodeShare(share)
      expect(plain.startsWith(`#s=${SHARE_VERSION}u.`)).toBe(true)
      expect(plain.length).toBeGreaterThan(hash.length)
      expect('share' in (await decodeShare(plain))).toBe(true)
      expect(await decodeShare(hash)).toEqual({ error: 'broken' }) // a deflated link, no way to open it here
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('refuses another version with its own error', async () => {
    const hash = (await encodeShare(share)).replace(`#s=${SHARE_VERSION}.`, '#s=2.')
    expect(await decodeShare(hash)).toEqual({ error: 'version' })
  })

  it('refuses corrupted or foreign input', async () => {
    const hash = await encodeShare(share)
    const bad = [
      '', '#', '#s=', '#s=1.', '#s=1.!!!', '#s=x.abc', '#other=1.abc', '#s=1',
      hash.slice(0, hash.length - 40), // cut short
      `${hash}%%`,
      '#s=1u.' + btoa('{"ll":[1,2]}'),
      '#s=1u.' + btoa('not json'),
      '#s=1u.' + btoa(JSON.stringify({ ll: [95, 0], d: '2026-12-21', m: 10, t: '3d', p: {} })),
      '#s=1u.' + btoa(JSON.stringify({ ll: [45, 9], d: '2026-12-21', m: 10, t: 'nope', p: {} })),
      '#s=1u.' + btoa(JSON.stringify({ ll: [45, 9], d: '2026-12-21', m: 10, t: '3d', p: { buildingId: 'x' } })),
    ]
    for (const b of bad) expect(await decodeShare(b)).toEqual({ error: 'broken' })
  })
})
