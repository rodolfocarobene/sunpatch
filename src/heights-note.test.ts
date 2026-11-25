import { describe, expect, it } from 'vitest'
import { heightsNoteDue } from './heights-note'

describe('heightsNoteDue', () => {
  const store = (value: string | null) => ({ getItem: () => value })

  it('shows the note until it has been dismissed', () => {
    expect(heightsNoteDue(store(null))).toBe(true)
    expect(heightsNoteDue(store('seen'))).toBe(false)
  })

  it('shows it when storage is missing or throws', () => {
    expect(heightsNoteDue(undefined)).toBe(true)
    expect(heightsNoteDue({ getItem: () => { throw new Error('blocked') } })).toBe(true)
  })
})
