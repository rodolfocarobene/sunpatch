import { describe, expect, it } from 'vitest'
import { parseSession } from './session'

const good = { lat: 45.46, lon: 9.19, view: '3d', date: '2026-12-21', minutes: 725 }

describe('parseSession', () => {
  it('reads a saved session', () => {
    expect(parseSession(JSON.stringify(good))).toEqual(good)
  })

  it('rejects missing, broken or out-of-range values', () => {
    expect(parseSession(null)).toBeNull()
    expect(parseSession('not json')).toBeNull()
    expect(parseSession(JSON.stringify({ ...good, view: 'settings' }))).toBeNull()
    expect(parseSession(JSON.stringify({ ...good, lat: 91 }))).toBeNull()
    expect(parseSession(JSON.stringify({ ...good, date: '21/12/2026' }))).toBeNull()
    expect(parseSession(JSON.stringify({ ...good, minutes: 1440 }))).toBeNull()
  })
})
