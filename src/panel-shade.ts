import { DoubleSide, Ray } from 'three'
import type { MeshBVH } from 'three-mesh-bvh'
import type { Panel } from './plan'
import { PANEL_THICKNESS, along, facing, footprintDepth, modules } from './panel'
import { sunDirection } from './sun'
import { clearSky, diffuseOnPlane, type EnergyIrradiation } from './solar'

// Shading analysis of one solar panel: sample points on its front face, rays toward the sun on 12 representative
// days of the year, summed into a month x hour matrix and yearly totals. This file is the maths and the tracing
// loop; sunmap.worker.ts runs it and panel-shade-job.ts caches and debounces it.

/** Sample points per module along each side (3 x 3 per module). */
export const SAMPLES_PER_SIDE = 3
/** Samples sit this far from the panel's mid-plane, 2 cm in front of its glass, so a ray never starts inside its own box. */
export const SAMPLE_OFFSET = PANEL_THICKNESS / 2 + 0.02
/** Minutes between slots. */
export const SLOT_MINUTES = 15
/** Days per month, a plain year: the 21st of each month stands for the whole month. */
export const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
export const REPRESENTATIVE_DAY = 21

export type Vec3 = [number, number, number]

/** Unit normal of the panel's front face. */
export function panelNormal(p: Panel): Vec3 {
  const t = (p.tilt * Math.PI) / 180
  const f = facing(p.azimuth)
  return [Math.sin(t) * f.x, Math.cos(t), Math.sin(t) * f.z]
}

/**
 * A grid of points on the front face, `SAMPLES_PER_SIDE` per module side, each module on its own, lifted
 * `SAMPLE_OFFSET` along the normal. Three numbers (x, y, z) per sample.
 */
export function panelSamples(p: Panel): Float32Array {
  const t = (p.tilt * Math.PI) / 180
  const f = facing(p.azimuth)
  const r = along(p.azimuth)
  const n = panelNormal(p)
  const up: Vec3 = [-Math.cos(t) * f.x, Math.sin(t), -Math.cos(t) * f.z]
  const reach = footprintDepth(p) / 2
  const low: Vec3 = [p.x + f.x * reach, p.elevation, p.z + f.z * reach]
  const count = modules(p)
  const side = SAMPLES_PER_SIDE
  const out = new Float32Array(count * side * side * 3)
  let at = 0
  for (let m = 0; m < count; m++) {
    for (let row = 0; row < side; row++) {
      for (let col = 0; col < side; col++) {
        const u = (m - (count - 1) / 2) * p.width + ((col + 0.5) / side - 0.5) * p.width
        const v = ((row + 0.5) / side) * p.height
        out[at++] = low[0] + r.x * u + up[0] * v + n[0] * SAMPLE_OFFSET
        out[at++] = low[1] + up[1] * v + n[1] * SAMPLE_OFFSET
        out[at++] = low[2] + r.z * u + up[2] * v + n[2] * SAMPLE_OFFSET
      }
    }
  }
  return out
}

export interface YearSlots {
  /** Month (0..11) of each slot. */
  month: Uint8Array
  /** Start of each slot, minutes of the local day. */
  start: Uint16Array
  /** Unit vectors toward the sun (x east, y up, z south), three numbers per slot. */
  dirs: Float32Array
}

/**
 * The slots of the 21st of every month, one per `SLOT_MINUTES` from sunrise to sunset (sun above the horizon at
 * the slot's middle), in the browser's local time like the time slider.
 */
export function yearSlots(lat: number, lon: number, year: number, step = SLOT_MINUTES): YearSlots {
  const month: number[] = []
  const start: number[] = []
  const dirs: number[] = []
  for (let m = 0; m < 12; m++) {
    for (let minute = 0; minute < 1440; minute += step) {
      const middle = new Date(year, m, REPRESENTATIVE_DAY, 0, minute, step * 30)
      const sun = sunDirection(middle, lat, lon)
      if (sun.altitudeDeg <= 0) continue
      month.push(m)
      start.push(minute)
      dirs.push(sun.vector.x, sun.vector.y, sun.vector.z)
    }
  }
  return { month: Uint8Array.from(month), start: Uint16Array.from(start), dirs: Float32Array.from(dirs) }
}

export interface PanelShade {
  /** [month][hour 0..23]: share of the panel's samples in direct sun, averaged over the hour's daylight slots. */
  lit: number[][]
  /** [month][hour]: share of those daylight slots with the sun in front of the panel (cos incidence above 0). */
  front: number[][]
  /** [month][hour]: share of the hour with the sun above the horizon. */
  up: number[][]
  /** Direct-sun hours on the panel on the representative day of each month. */
  monthHours: number[]
  /** The same per day, weighted by cos(incidence): what the face actually receives, not just hours. */
  monthCosHours: number[]
  /** Direct-sun hours over the year: the twelve days scaled by days per month. */
  annualHours: number
  /** Hours with the sun in front of the panel and nothing in the way. */
  potentialHours: number
  /** Annual sum of cos(incidence) x lit share, in hours: what the energy step turns into kWh. */
  annualCosHours: number
  /** The same with no obstacles. */
  potentialCosHours: number
  /** 1 - annualCosHours / potentialCosHours, 0..1: the energy lost to shading, not just hours. */
  shadingLoss: number
  /** Clear-sky irradiation per representative day, the input of the energy step (see solar.ts). */
  irradiation: EnergyIrradiation
  /** Rays cast, and the time the tracing took, milliseconds. */
  rays: number
  ms: number
}

const matrix = (): number[][] => Array.from({ length: 12 }, () => new Array<number>(24).fill(0))

/**
 * Traces the panel. A sample is lit in a slot when the sun is in front of the panel (cos incidence above 0) and the
 * ray toward it hits nothing; slots with the sun behind the panel cost no rays. The panel's own boxes may be in the
 * BVH: the samples lie in front of them and the rays point away.
 */
export function shadePanel(bvh: MeshBVH, panel: Panel, slots: YearSlots): PanelShade {
  const started = performance.now()
  const samples = panelSamples(panel)
  const count = samples.length / 3
  const normal = panelNormal(panel)
  const ray = new Ray()
  const lit = matrix()
  const front = matrix()
  const up = matrix()
  const daylight = matrix() // slots with the sun up, per month and hour
  const monthHours = new Array<number>(12).fill(0)
  const monthCos = new Array<number>(12).fill(0)
  const monthPotential = new Array<number>(12).fill(0)
  const monthPotentialCos = new Array<number>(12).fill(0)
  const slotHours = SLOT_MINUTES / 60
  const beam = new Array<number>(12).fill(0)
  const beamOpen = new Array<number>(12).fill(0)
  const diffuse = new Array<number>(12).fill(0)
  const perHour = 60 / SLOT_MINUTES
  let rays = 0
  for (let i = 0; i < slots.start.length; i++) {
    const m = slots.month[i]
    const h = Math.floor(slots.start[i] / 60)
    const dx = slots.dirs[i * 3]
    const dy = slots.dirs[i * 3 + 1]
    const dz = slots.dirs[i * 3 + 2]
    const cos = dx * normal[0] + dy * normal[1] + dz * normal[2]
    daylight[m][h]++
    up[m][h] += 1 / perHour
    const sky = clearSky((Math.asin(Math.min(1, dy)) * 180) / Math.PI)
    diffuse[m] += (diffuseOnPlane(sky, panel.tilt) * slotHours) / 1000
    if (cos <= 0) continue
    beamOpen[m] += (sky.dni * cos * slotHours) / 1000
    front[m][h]++
    monthPotential[m] += slotHours
    monthPotentialCos[m] += slotHours * cos
    ray.direction.set(dx, dy, dz)
    let seen = 0
    for (let s = 0; s < count; s++) {
      ray.origin.set(samples[s * 3], samples[s * 3 + 1], samples[s * 3 + 2])
      rays++
      if (!bvh.raycastFirst(ray, DoubleSide)) seen++
    }
    const share = seen / count
    lit[m][h] += share
    monthHours[m] += share * slotHours
    monthCos[m] += share * slotHours * cos
    beam[m] += (share * sky.dni * cos * slotHours) / 1000
  }
  let annualHours = 0
  let potentialHours = 0
  let annualCosHours = 0
  let potentialCosHours = 0
  for (let m = 0; m < 12; m++) {
    annualHours += monthHours[m] * DAYS_IN_MONTH[m]
    potentialHours += monthPotential[m] * DAYS_IN_MONTH[m]
    annualCosHours += monthCos[m] * DAYS_IN_MONTH[m]
    potentialCosHours += monthPotentialCos[m] * DAYS_IN_MONTH[m]
    for (let h = 0; h < 24; h++) {
      // lit and front hold sums over the hour's slots; make them shares of its daylight slots.
      const slotsUp = daylight[m][h]
      lit[m][h] = slotsUp ? lit[m][h] / slotsUp : 0
      front[m][h] = slotsUp ? front[m][h] / slotsUp : 0
    }
  }
  const shadingLoss = potentialCosHours > 0 ? Math.max(0, 1 - annualCosHours / potentialCosHours) : 0
  return {
    lit, front, up, monthHours, monthCosHours: monthCos, annualHours, potentialHours, annualCosHours, potentialCosHours, shadingLoss,
    irradiation: { beam, beamOpen, diffuse }, rays, ms: performance.now() - started,
  }
}
