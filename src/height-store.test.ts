import { beforeEach, describe, expect, it } from 'vitest'
import { createHeightStore, HEIGHTS_KEY, KEEP_KEY, resolveHeights, TTL_MS } from './height-store'

class MemStorage implements Storage {
  private m = new Map<string, string>()
  get length() {
    return this.m.size
  }
  clear() {
    this.m.clear()
  }
  getItem(k: string) {
    return this.m.get(k) ?? null
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null
  }
  removeItem(k: string) {
    this.m.delete(k)
  }
  setItem(k: string, v: string) {
    this.m.set(k, v)
  }
}

const DAY = 24 * 60 * 60 * 1000
let local: MemStorage
let session: MemStorage
let clock: number
const make = () => createHeightStore({ local, session, now: () => clock })

beforeEach(() => {
  local = new MemStorage()
  session = new MemStorage()
  clock = 1_000_000_000_000
})

describe('height store', () => {
  it('sets, gets and forgets an override', () => {
    const s = make()
    s.setMode('keep')
    s.set('way/1', { height: 30, levels: 10 })
    expect(s.load()).toEqual({ 'way/1': { height: 30, levels: 10 } })
    expect(s.count()).toBe(1)
    expect(make().load()['way/1']).toEqual({ height: 30, levels: 10 }) // a fresh store reads it back
    s.set('way/1', null)
    expect(s.load()).toEqual({})
    expect(local.getItem(HEIGHTS_KEY)).toBeNull()
  })

  it('drops overrides older than 30 days and prunes them from storage', () => {
    const s = make()
    s.setMode('keep')
    s.set('way/old', { height: 12 })
    clock += 29 * DAY
    s.set('way/new', { height: 20 })
    clock += 2 * DAY // way/old is now 31 days old, way/new 2
    expect(Object.keys(make().load())).toEqual(['way/new'])
    expect(Object.keys(JSON.parse(local.getItem(HEIGHTS_KEY)!).items)).toEqual(['way/new'])
    clock += TTL_MS
    expect(make().load()).toEqual({})
    expect(local.getItem(HEIGHTS_KEY)).toBeNull()
  })

  it('editing again refreshes the timestamp; reading does not', () => {
    const s = make()
    s.setMode('keep')
    s.set('way/1', { height: 12 })
    clock += 20 * DAY
    s.load()
    clock += 11 * DAY
    expect(s.load()).toEqual({}) // 31 days after the edit: reading in between did not extend it
    s.set('way/2', { height: 12 })
    clock += 20 * DAY
    s.set('way/2', { height: 15 })
    clock += 20 * DAY
    expect(s.load()['way/2']).toEqual({ height: 15 })
  })

  it('ignores damaged storage and invalid entries', () => {
    local.setItem(HEIGHTS_KEY, '{nope')
    expect(make().load()).toEqual({})
    local.setItem(HEIGHTS_KEY, JSON.stringify({ v: 1, items: { a: { o: { height: -4 }, t: clock }, b: { o: { height: 9 }, t: clock } } }))
    expect(make().load()).toEqual({ b: { height: 9 } })
  })

  it('migrates plan heights: new ids come in, stored ones (edited later) win', () => {
    const s = make()
    s.setMode('keep')
    s.set('way/1', { height: 40 })
    s.migrate({ 'way/1': { height: 10 }, 'way/2': { height: 25, levels: 8 } })
    expect(s.load()).toEqual({ 'way/1': { height: 40 }, 'way/2': { height: 25, levels: 8 } })
    expect(local.getItem(HEIGHTS_KEY)).toContain('way/2') // legacy heights were already on the device: localStorage
  })

  it('keeps an unanswered or session-only choice out of localStorage', () => {
    const s = make()
    s.set('way/1', { height: 12 }) // not asked yet
    expect(s.mode()).toBeUndefined()
    expect(local.getItem(HEIGHTS_KEY)).toBeNull()
    expect(session.getItem(HEIGHTS_KEY)).toContain('way/1')
    s.setMode('keep') // the answer moves it
    expect(local.getItem(HEIGHTS_KEY)).toContain('way/1')
    expect(session.getItem(HEIGHTS_KEY)).toBeNull()
    s.setMode('session') // and back: it no longer outlives the tab
    expect(local.getItem(HEIGHTS_KEY)).toBeNull()
    expect(local.getItem(KEEP_KEY)).toBe('session')
    expect(make().load()['way/1']).toEqual({ height: 12 })
    expect(createHeightStore({ local: new MemStorage(), session, now: () => clock }).load()['way/1']).toEqual({ height: 12 }) // same tab
    expect(createHeightStore({ local, session: new MemStorage(), now: () => clock }).load()).toEqual({}) // new tab
  })

  it('clear forgets everything but the answer', () => {
    const s = make()
    s.setMode('keep')
    s.set('way/1', { height: 12 })
    s.clear()
    expect(s.count()).toBe(0)
    expect(s.mode()).toBe('keep')
  })

  it('a shared copy applies its heights for viewing and writes nothing', () => {
    const s = make()
    s.setMode('keep')
    s.set('way/1', { height: 40 })
    const before = local.getItem(HEIGHTS_KEY)
    const shown = resolveHeights(s, { 'way/1': { height: 7 }, 'way/9': { height: 33 } }, true)
    expect(shown).toEqual({ 'way/1': { height: 7 }, 'way/9': { height: 33 } })
    expect(local.getItem(HEIGHTS_KEY)).toBe(before)
    expect(session.getItem(HEIGHTS_KEY)).toBeNull()
    expect(s.load()['way/9']).toBeUndefined()
    s.put({ 'way/9': { height: 33 } }) // "Save as mine"
    expect(s.load()['way/9']).toEqual({ height: 33 })
  })

  it('an own plan hands its heights to the store', () => {
    const s = make()
    expect(resolveHeights(s, { 'way/3': { height: 18 } }, false)).toEqual({ 'way/3': { height: 18 } })
    expect(make().load()['way/3']).toEqual({ height: 18 })
  })
})
