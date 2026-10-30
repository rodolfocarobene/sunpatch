import { fmtNumber, t } from './i18n'
import { buildingContains, type Building } from './osm'
import { ROOF_TILT } from './panel'
import { DAYS_IN_MONTH, SLOT_MINUTES, panelNormal, yearSlots } from './panel-shade'
import type { Panel } from './plan'
import { clearSky, diffuseOnPlane, panelEnergy, type Assumptions, type EnergyIrradiation, type PanelEnergy } from './solar'

// What the panel card says first: one sentence with a verdict, a warning when the panel cannot be right, and an
// honest yardstick (an unshaded panel of the same size, at its best simple tilt, at this place).

/** At or above this share of energy lost to shading the panel is "almost always in shade". */
export const SHADE_WARNING_LOSS = 0.95

/** A panel whose lowest edge is under the roof and whose centre is inside the footprint is inside the building. */
export const panelInside = (panel: Panel, building: Building): boolean =>
  panel.elevation < building.height && buildingContains(building, { x: panel.x, z: panel.z })

/** What the Panels list says in place of a yearly figure for a panel inside the building. */
export const EXCLUDED_INSIDE = t('panels.excluded')

/**
 * The totals line over the panels' yearly kWh. A panel inside the building is not counted (its figure is the sun
 * of a buried panel, which is meaningless), and the line says how many were left out.
 */
export function totalsLine(panels: { kwh: number; inside: boolean }[], weather: boolean): string {
  const counted = panels.filter((p) => !p.inside)
  const left = panels.length - counted.length
  const note = left > 0 ? t('panels.notCounted', { n: left }) : ''
  if (counted.length === 0) return t('panels.noneCounted', { n: left })
  const sum = counted.reduce((total, p) => total + p.kwh, 0)
  return t(weather ? 'panels.totalWeather' : 'panels.totalClear', { count: t('panels.count', { n: counted.length }), kwh: kwh(sum), note })
}

export interface Verdict {
  sentence: string
  /** True when the sentence is a warning: the panel is inside the building or almost always in shade. */
  warning: boolean
}

export interface VerdictInput {
  energy: PanelEnergy
  weather: 'loading' | 'ready' | 'error'
  /** Share of the energy lost to shading, 0..1 (PanelShade.shadingLoss). */
  shadingLoss: number
  inside: boolean
}

const kwh = (v: number): string => `${fmtNumber(Math.round(v))} kWh`
const round10 = (v: number): string => `${fmtNumber(Math.round(v / 10) * 10)} kWh`

/** "Shading costs under 1%", or the good news. */
function shadingClause(e: PanelEnergy): string {
  if (e.idealOpen <= 0) return ''
  if (e.shadingCost < 0.5) return t('panels.clauseNone')
  return e.shadingShare < 0.005 ? t('panels.clauseUnder1') : t('panels.clausePct', { pct: Math.round(e.shadingShare * 100) })
}

/** The one sentence: the yearly energy and how it compares with the ideal, or a warning. */
export function verdict({ energy, weather, shadingLoss, inside }: VerdictInput): Verdict {
  if (inside) return { sentence: t('panels.inside'), warning: true }
  if (shadingLoss >= SHADE_WARNING_LOSS) return { sentence: t('panels.alwaysShade'), warning: true }
  if (weather === 'ready' && energy.weather !== undefined) {
    const share = energy.ideal > 0 ? Math.round((energy.weather / energy.ideal) * 100) : 0
    return { sentence: t('panels.verdictWeather', { kwh: kwh(energy.weather), share, clause: shadingClause(energy) }), warning: false }
  }
  const tail = t(weather === 'loading' ? 'panels.tailLoading' : 'panels.tailUnavailable')
  return { sentence: t('panels.verdictClear', { kwh: kwh(energy.ideal), clause: shadingClause(energy), tail }), warning: false }
}

/** Clear-sky irradiation of a panel with nothing in the way: the same days and slots as the traced analysis. */
export function openIrradiation(panel: Panel, lat: number, lon: number, year: number): EnergyIrradiation {
  const slots = yearSlots(lat, lon, year)
  const n = panelNormal(panel)
  const beam = new Array<number>(12).fill(0)
  const diffuse = new Array<number>(12).fill(0)
  const hours = SLOT_MINUTES / 60
  for (let i = 0; i < slots.start.length; i++) {
    const m = slots.month[i]
    const dy = slots.dirs[i * 3 + 1]
    const sky = clearSky((Math.asin(Math.min(1, dy)) * 180) / Math.PI)
    diffuse[m] += (diffuseOnPlane(sky, panel.tilt) * hours) / 1000
    const cos = slots.dirs[i * 3] * n[0] + dy * n[1] + slots.dirs[i * 3 + 2] * n[2]
    if (cos > 0) beam[m] += (sky.dni * cos * hours) / 1000
  }
  return { beam, beamOpen: beam, diffuse }
}

/**
 * The yardstick: an unshaded panel of the same size, tilted 30 degrees and facing the equator (south in the
 * northern hemisphere), at this place. Same models and assumptions as the card, so the two compare.
 */
export function referenceEnergy(panel: Panel, lat: number, lon: number, year: number, a: Assumptions, clearness?: number[]): PanelEnergy {
  const ref: Panel = { ...panel, id: 'reference', x: 0, z: 0, elevation: 0, tilt: ROOF_TILT, azimuth: lat < 0 ? 0 : 180 }
  const area = ref.width * ref.height * (ref.count ?? 1)
  return panelEnergy(openIrradiation(ref, lat, lon, year), area, a, DAYS_IN_MONTH, clearness)
}

/** "An unshaded panel of the same size, tilted 30 degrees and facing south, would make about 1,040 kWh a year here." */
export function referenceLine(ref: PanelEnergy, weather: boolean, lat: number): string {
  const figure = weather && ref.weather !== undefined ? t('panels.refWeather', { kwh: round10(ref.weather) }) : t('panels.refClear', { kwh: round10(ref.ideal) })
  return t('panels.refLine', { tilt: ROOF_TILT, dir: t(lat < 0 ? 'panels.dirN' : 'panels.dirS'), figure })
}
