import { describe, expect, it } from 'vitest'
import { clearsNote, shortcutFor, TOOL_KEYS, windowCount } from './editor-keys'

describe('shortcutFor', () => {
  it('maps each tool key, either case', () => {
    expect(shortcutFor({ key: 'v' })).toEqual({ tool: 'select' })
    expect(shortcutFor({ key: 'O' })).toEqual({ tool: 'outline' })
    expect(shortcutFor({ key: 'w' })).toEqual({ tool: 'wall' })
    expect(shortcutFor({ key: 'n' })).toEqual({ tool: 'window' })
    expect(shortcutFor({ key: 'b' })).toEqual({ tool: 'fix' })
  })

  it('maps F to fit', () => {
    expect(shortcutFor({ key: 'f' })).toEqual({ action: 'fit' })
  })

  it('ignores other keys and modified presses (Ctrl+Z, Ctrl+O...)', () => {
    expect(shortcutFor({ key: 'x' })).toBeUndefined()
    expect(shortcutFor({ key: 'Escape' })).toBeUndefined()
    expect(shortcutFor({ key: 'o', ctrlKey: true })).toBeUndefined()
    expect(shortcutFor({ key: 'w', metaKey: true })).toBeUndefined()
    expect(shortcutFor({ key: 'f', altKey: true })).toBeUndefined()
  })

  it('uses a distinct key per tool', () => {
    const keys = Object.values(TOOL_KEYS)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).not.toContain('F')
  })
})

describe('window wording', () => {
  it('pluralises', () => {
    expect(windowCount(1)).toBe('1 window')
    expect(windowCount(3)).toBe('3 windows')
  })

  it('names what a replaced outline costs', () => {
    expect(clearsNote(3)).toBe('Clears 3 windows')
    expect(clearsNote(0)).toBe('')
  })
})
