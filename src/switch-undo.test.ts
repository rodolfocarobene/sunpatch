import { describe, expect, it } from 'vitest'
import { buildingClickAction, createUndoSlot } from './switch-undo'

describe('buildingClickAction', () => {
  it('switches in 3D and in Panels without the suitability map', () => {
    expect(buildingClickAction('3d', false)).toBe('switch')
    expect(buildingClickAction('panels', false)).toBe('switch')
  })
  it('only explains in Panels while the suitability map is on', () => {
    expect(buildingClickAction('panels', true)).toBe('explain')
    expect(buildingClickAction('3d', true)).toBe('switch')
  })
  it('leaves Garden clicks to spot picking', () => {
    expect(buildingClickAction('garden', false)).toBe('ignore')
  })
})

describe('createUndoSlot', () => {
  it('hands the state back once', () => {
    const slot = createUndoSlot<string>()
    expect(slot.take()).toBeUndefined()
    slot.set('a')
    expect(slot.has).toBe(true)
    expect(slot.take()).toBe('a')
    expect(slot.take()).toBeUndefined()
  })
  it('keeps only the newest state and can be cleared', () => {
    const slot = createUndoSlot<number>()
    slot.set(1)
    slot.set(2)
    expect(slot.take()).toBe(2)
    slot.set(3)
    slot.clear()
    expect(slot.has).toBe(false)
  })
})
