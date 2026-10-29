import { describe, expect, it } from 'vitest'
import { cellInfo, chartHours, formatHours, formatLoss } from './panel-card'
import type { PanelShade } from './panel-shade'

const grid = (v: number): number[][] => Array.from({ length: 12 }, () => new Array<number>(24).fill(v))

const shade = (): PanelShade => {
  const s: PanelShade = {
    lit: grid(0), front: grid(1), up: grid(1), monthHours: [], monthCosHours: [], annualHours: 1420, potentialHours: 1610,
    annualCosHours: 0, potentialCosHours: 0, shadingLoss: 0.12, irradiation: { beam: [], beamOpen: [], diffuse: [] }, rays: 0, ms: 0,
  }
  s.lit[5][15] = 0.8
  s.front[5][8] = 0
  s.up[5][2] = 0
  return s
}

describe('panel card text', () => {
  it('words the tooltip for sun, a panel turned away and night', () => {
    const s = shade()
    expect(cellInfo(s, 5, 15).text).toBe('June, 15:00–16:00: 80% of the panel in sun')
    expect(cellInfo(s, 5, 8)).toMatchObject({ kind: 'behind', text: 'June, 08:00–09:00: sun behind the panel' })
    expect(cellInfo(s, 5, 2).kind).toBe('night')
  })

  it('covers hours 4 to 21 and widens for a sun outside them', () => {
    const s = shade()
    for (const row of s.up) row.fill(0)
    expect(chartHours(s)).toEqual([4, 21])
    s.up[5][3] = 0.5
    s.up[5][22] = 1
    expect(chartHours(s)).toEqual([3, 22])
  })

  it('formats hours and loss', () => {
    expect(formatHours(1420.4)).toBe('1,420 h')
    expect(formatLoss(0.123)).toBe('12%')
    expect(formatLoss(0.001)).toBe('<1%')
    expect(formatLoss(0)).toBe('0%')
  })
})
