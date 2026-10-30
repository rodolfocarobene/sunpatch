import { afterEach, describe, expect, it } from 'vitest'
import { detectLang, fmtDay, fmtNumber, fmtTime, t, useLang, type Key } from './i18n'
import { en, it as italian, SECTIONS } from './i18n/index'

afterEach(() => useLang('en'))

describe('t', () => {
  it('returns the English text by default and the Italian one after switching', () => {
    expect(t('shell.tabMap')).toBe('Map')
    useLang('it')
    expect(t('shell.tabMap')).toBe('Mappa')
  })

  it('fills {name} params and leaves unknown ones in place', () => {
    expect(t('shell.switchedTo', { name: 'Casa Rossa' })).toBe('Switched to Casa Rossa.')
    expect(t('shell.switchedTo', {})).toBe('Switched to {name}.')
  })

  it('picks the plural form from n, per language, and formats n for the locale', () => {
    expect(t('shell.hoodLine', { n: 1, r: 300 })).toBe('1 building within 300 m')
    expect(t('shell.hoodLine', { n: 1234, r: 300 })).toBe('1,234 buildings within 300 m')
    useLang('it')
    expect(t('shell.hoodLine', { n: 1, r: 300 })).toBe('1 edificio entro 300 m')
    expect(t('shell.hoodLine', { n: 0, r: 300 })).toBe('0 edifici entro 300 m')
    expect(t('shell.hoodLine', { n: 12345, r: 300 })).toBe('12.345 edifici entro 300 m')
  })

  it('falls back to English for a key the Italian dictionary lacks', () => {
    const key = 'shell.tabMap' as Key
    const saved = italian[key]
    delete (italian as Partial<typeof italian>)[key]
    try {
      useLang('it')
      expect(t(key)).toBe('Map')
    } finally {
      ;(italian as Record<string, unknown>)[key] = saved
    }
  })
})

describe('detectLang', () => {
  it('maps it* to Italian and everything else to English', () => {
    expect(detectLang(['it'])).toBe('it')
    expect(detectLang(['it-CH', 'en'])).toBe('it')
    expect(detectLang(['IT-it'])).toBe('it')
    expect(detectLang(['en-US', 'it'])).toBe('en')
    expect(detectLang(['de-DE'])).toBe('en')
    expect(detectLang(['italic'])).toBe('en')
    expect(detectLang([])).toBe('en')
  })
})

describe('formatting follows the locale', () => {
  it('formats numbers, times and short dates', () => {
    expect(fmtNumber(12345.5)).toBe('12,345.5')
    expect(fmtTime(new Date(2026, 11, 21, 8, 1))).toBe('08:01')
    expect(fmtTime(null)).toBe('')
    expect(fmtDay(11, 21)).toBe('21 Dec')
    useLang('it')
    expect(fmtNumber(12345.5)).toBe('12.345,5')
    expect(fmtTime(new Date(2026, 11, 21, 8, 1))).toBe('08:01')
    expect(fmtDay(11, 21)).toBe('21 dic')
  })
})

describe('dictionary', () => {
  it('has every English key in Italian, and the same plural shape', () => {
    const missing = Object.keys(en).filter((k) => !(k in italian))
    expect(missing).toEqual([])
    for (const [key, message] of Object.entries(en)) {
      expect(typeof italian[key as Key], key).toBe(typeof message)
    }
  })

  it('has no key in two sections and no key in Italian only', () => {
    const all = SECTIONS.flatMap((s) => Object.keys(s.en))
    expect(new Set(all).size).toBe(all.length)
    expect(Object.keys(italian).filter((k) => !(k in en))).toEqual([])
  })

  it('uses the same {params} in both languages (Italian may drop a plant {name}: it needs an article that depends on gender)', () => {
    const params = (m: unknown, skip = false) =>
      [...JSON.stringify(m).matchAll(/\{(\w+)\}/g)].map((x) => x[1]).filter((p) => !skip || (p !== 'name' && p !== 'Name')).sort().join()
    for (const key of Object.keys(en)) {
      const k = key as Key
      const it = params(italian[k])
      expect([params(en[k]), params(en[k], true)], key).toContain(it)
    }
  })
})
