import { afterEach, describe, expect, it } from 'vitest'
import { fmtMonth, upFirst, useLang } from './i18n'
import { formatKwh, shadingLine } from './panel-card'
import { totalsLine, verdict } from './panel-verdict'
import { PLANTS, plantById, plantMatches, plantName } from './plants'
import { rangeText, round10, surfaceLabel } from './suitability'
import { monthsText } from './garden-text'
import { explain, rateMonth } from './garden'
import { compass } from './garden-find'

afterEach(() => useLang('en'))

describe('plant names and search', () => {
  const tomato = plantById('tomato')!

  it('shows the Italian name in Italian', () => {
    expect(plantName(tomato)).toBe('tomato')
    useLang('it')
    expect(plantName(tomato)).toBe('pomodoro')
  })

  it('matches either name in either language, ignoring case and accents', () => {
    for (const lang of ['en', 'it'] as const) {
      useLang(lang)
      expect(plantMatches(tomato, 'tomato')).toBe(true)
      expect(plantMatches(tomato, 'Pomod')).toBe(true)
      expect(plantMatches(tomato, 'basilico')).toBe(false)
    }
    expect(plantMatches(plantById('basil')!, ' BASIL ')).toBe(true)
    expect(plantMatches(plantById('lambs-lettuce')!, 'valerianella')).toBe(true)
    expect(plantMatches(tomato, '')).toBe(true)
  })

  it('gives every plant an Italian name', () => {
    for (const p of PLANTS) expect(p.nameIt.trim(), p.id).not.toBe('')
  })
})

describe('months', () => {
  it('names months per language', () => {
    expect(fmtMonth(5)).toBe('June')
    expect(fmtMonth(5, 'short')).toBe('Jun')
    useLang('it')
    expect(fmtMonth(5)).toBe('giugno')
    expect(upFirst(fmtMonth(5))).toBe('Giugno')
    expect(fmtMonth(0, 'short')).toBe('gen')
  })

  it('writes runs of months', () => {
    const marToOct = Array.from({ length: 12 }, (_, m) => m >= 2 && m <= 9)
    expect(monthsText(marToOct)).toBe('Mar to Oct')
    useLang('it')
    expect(monthsText(marToOct)).toBe('da mar a ott')
    expect(monthsText(Array(12).fill(true))).toBe('tutto l’anno')
  })
})

describe('panel and suitability text follows the language', () => {
  it('formats energy figures with the locale', () => {
    expect(formatKwh(1234.4)).toBe('1,234 kWh')
    expect(round10(1234)).toBe('1,230')
    useLang('it')
    expect(formatKwh(12345.4)).toBe('12.345 kWh')
    expect(rangeText([650, 1400])).toBe('650 … 1400 kWh/anno per kW')
  })

  it('says the totals line and the verdict in Italian', () => {
    useLang('it')
    expect(totalsLine([{ kwh: 500, inside: false }, { kwh: 700, inside: true }], true)).toBe(
      '1 pannello · ~500 kWh/anno con il meteo locale (1 pannello dentro l’edificio non contato)',
    )
    const energy = { ideal: 1000, idealOpen: 1000, shadingCost: 0, shadingShare: 0 } as Parameters<typeof verdict>[0]['energy']
    expect(verdict({ energy, weather: 'error', shadingLoss: 0, inside: false }).sentence).toBe(
      'Circa 1000 kWh/anno con cielo sereno. Niente fa ombra. Il meteo locale non è disponibile.',
    )
    expect(shadingLine({ ...energy, shadingCost: 120, shadingShare: 0.08 } as Parameters<typeof shadingLine>[0])).toBe('Perdita per ombra: 120 kWh (8%)')
  })

  it('names the surface and compass points', () => {
    expect(surfaceLabel({ kind: 'facade', azimuth: 225, tilt: 90, y: 7 })).toBe('Facade facing south-west, 7 m up')
    useLang('it')
    expect(surfaceLabel({ kind: 'facade', azimuth: 225, tilt: 90, y: 7 })).toBe('Facciata rivolta a sud-ovest, a 7 m di altezza')
    expect(surfaceLabel({ kind: 'roof', azimuth: 180, tilt: 30, y: 9 })).toBe('Tetto, 30° sud')
    expect(compass(0, 10, 1)).toBe('sud')
  })
})

describe('plant sentences', () => {
  const basil = plantById('basil')!
  const dark = rateMonth(basil, { indoor: false, sunMinutes: Array(12).fill(40) }, { tMean: Array(12).fill(22), tMin: Array(12).fill(15), tMax: Array(12).fill(28), tLow: Array(12).fill(12) }, 11)

  it('explains a month in both languages, with the plant name only in English', () => {
    expect(explain(basil, dark)).toBe('Too dark in December: 40 min of direct sun, basil needs 6 h.')
    useLang('it')
    expect(explain(basil, dark)).toBe('Troppo buio in dicembre: 40 min di sole diretto, ne servono 6 h.')
  })
})
