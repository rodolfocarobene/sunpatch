import { DoubleSide, Ray } from 'three'
import type { MeshBVH } from 'three-mesh-bvh'
import { buildingContains, distanceToRing, type Building, type Point } from './osm'
import type { Panel } from './plan'
import { DEFAULT_PANEL, FACADE_GAP, GROUND_ELEVATION, ROOF_TILT, azimuthOf, edgeOutward, facing } from './panel'
import { clearSky, diffuseOnPlane, panelEnergy, DEFAULT_ASSUMPTIONS, type Assumptions, type EnergyIrradiation } from './solar'
import { DAYS_IN_MONTH, type YearSlots } from './panel-shade'
import { FULL_SUN_MINUTES, sunColor } from './sunmap'

// "Where should I put panels?": candidate surfaces around the selected building (facade, roof, ground), each sampled
// on a grid and given the same annual energy per kWp as a panel card. This file holds the sample generation, the
// tracing of a batch of samples (run by sunmap.worker.ts) and the figures; suitability-job.ts runs it progressively.

/** Facade cells are this big along the wall and up it, metres. */
export const FACADE_CELL = 1
/** Roof cells, metres. */
export const ROOF_CELL = 1
/** A roof sample keeps this far from the roof edge, so a stand does not hang over it. */
export const ROOF_MARGIN = 0.3
/** Ground cells, metres. */
export const GROUND_CELL = 2
/** The ground ring reaches this far from the building. */
export const GROUND_REACH = 18
/** Ground samples keep this far from any building. */
export const GROUND_MARGIN = 1
/** Walls shorter than this (jogs in the outline) get no samples. */
const MIN_WALL = 0.8
/** Facade rays start this far in front of the wall. */
const FACADE_LIFT = 0.05
/** Roof and ground rays start at the middle of a 30 degree stand: its low edge plus half its rise. */
const STAND_RISE = (DEFAULT_PANEL.height * Math.sin((ROOF_TILT * Math.PI) / 180)) / 2
/** Minutes between slots when tracing the map (the panel cards use 15). */
export const SUITABILITY_SLOT_MINUTES = 30

export type SurfaceKind = 'facade' | 'roof' | 'ground'

export interface SurfaceSample {
  kind: SurfaceKind
  /** The surface point (a facade cell's centre on the wall face, a roof or ground cell's centre on the surface). */
  x: number
  y: number
  z: number
  /** Degrees clockwise from north that a panel here faces, and its tilt (90 vertical). */
  azimuth: number
  tilt: number
  /** Cell size, metres (the quad drawn for it). */
  size: number
  /** Facade: the top of the wall above this cell; roofs: the roof height. Metres. */
  top: number
}

/** Direction stands face: south in the northern hemisphere, north in the southern. */
export const standAzimuth = (lat: number): number => (lat < 0 ? 0 : 180)

/** Height range of the member nearest to a wall point (the walls of a merged building can differ in height). */
function wallRange(members: Building[], p: Point): { bottom: number; top: number } {
  let best: { d: number; b: Building } | undefined
  for (const m of members) {
    const d = Math.min(distanceToRing(m.outer, p), ...m.holes.map((h) => distanceToRing(h, p)))
    if (!best || d < best.d - 0.05 || (d <= best.d + 0.05 && m.height > best.b.height)) best = { d, b: m }
  }
  return { bottom: best ? Math.max(0, best.b.minHeight) : 0, top: best ? best.b.height : 0 }
}

/** True when `p` lies in the footprint of a building of the list that is taller than `y`. */
const buriedIn = (others: Building[], p: Point, y: number): boolean => others.some((b) => b.height > y && buildingContains(b, p))

/**
 * Wall cells on the outer boundary of the selected building's merged footprint (outer ring and courtyards), about
 * 1 m along by 1 m up from the bottom of each wall to its eaves. A wall inside the selection (party wall between
 * members) is not on the boundary, and a cell pressed against an unselected neighbour is dropped.
 */
export function facadeSamples(selected: Building, others: Building[]): SurfaceSample[] {
  const members = selected.members ?? [selected]
  const out: SurfaceSample[] = []
  const rings: { ring: Point[]; hole: boolean }[] = [{ ring: selected.outer, hole: false }, ...selected.holes.map((ring) => ({ ring, hole: true }))]
  for (const { ring, hole } of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      const length = Math.hypot(b.x - a.x, b.z - a.z)
      if (length < MIN_WALL) continue
      const n = edgeOutward(ring, i, hole)
      const azimuth = azimuthOf(n.x, n.z)
      const columns = Math.max(1, Math.round(length / FACADE_CELL))
      for (let c = 0; c < columns; c++) {
        const t = (c + 0.5) / columns
        const wall = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }
        const { bottom, top } = wallRange(members, wall)
        const rows = Math.floor(top - bottom)
        if (rows < 1) continue
        const step = (top - bottom) / rows
        const front = { x: wall.x + n.x * 0.3, z: wall.z + n.z * 0.3 }
        for (let r = 0; r < rows; r++) {
          const y = bottom + (r + 0.5) * step
          if (buriedIn(others, front, y)) continue
          out.push({ kind: 'facade', x: wall.x, y, z: wall.z, azimuth, tilt: 90, size: FACADE_CELL, top })
        }
      }
    }
  }
  return out
}

/**
 * Roof cells of every member (a flat roof at its own height) on a 1 m grid, kept `ROOF_MARGIN` inside the edge.
 * Where two members overlap, only the taller one's roof counts.
 */
export function roofSamples(selected: Building, azimuth: number): SurfaceSample[] {
  const members = selected.members ?? [selected]
  const out: SurfaceSample[] = []
  members.forEach((m, k) => {
    const xs = m.outer.map((p) => p.x)
    const zs = m.outer.map((p) => p.z)
    const x0 = Math.floor(Math.min(...xs))
    const z0 = Math.floor(Math.min(...zs))
    for (let x = x0 + ROOF_CELL / 2; x < Math.max(...xs); x += ROOF_CELL) {
      for (let z = z0 + ROOF_CELL / 2; z < Math.max(...zs); z += ROOF_CELL) {
        const p = { x, z }
        if (!buildingContains(m, p)) continue
        if (Math.min(distanceToRing(m.outer, p), ...m.holes.map((h) => distanceToRing(h, p))) < ROOF_MARGIN) continue
        const covered = members.some((o, j) => j !== k && (o.height > m.height + 0.01 || (o.height >= m.height - 0.01 && j < k)) && buildingContains(o, p))
        if (covered) continue
        out.push({ kind: 'roof', x, y: m.height, z, azimuth, tilt: ROOF_TILT, size: ROOF_CELL, top: m.height })
      }
    }
  })
  return out
}

/**
 * A ring of ground cells around the selected building, out to `GROUND_REACH` m on a 2 m grid, without the footprints
 * of any building (selected or not; courtyards of the selection are ground).
 */
export function groundSamples(selected: Building, buildings: Building[], azimuth: number): SurfaceSample[] {
  const ownIds = new Set(selected.sources ?? [selected.id])
  const others = buildings.filter((b) => !ownIds.has(b.id) && b.id !== selected.id)
  const pad = GROUND_REACH + GROUND_MARGIN
  const xs = selected.outer.map((p) => p.x)
  const zs = selected.outer.map((p) => p.z)
  const box = { x0: Math.min(...xs) - pad, x1: Math.max(...xs) + pad, z0: Math.min(...zs) - pad, z1: Math.max(...zs) + pad }
  const near = others.filter((b) => b.outer.some((p) => p.x > box.x0 - 50 && p.x < box.x1 + 50 && p.z > box.z0 - 50 && p.z < box.z1 + 50))
  const rings = [selected.outer, ...selected.holes]
  const out: SurfaceSample[] = []
  for (let x = Math.ceil(box.x0 / GROUND_CELL) * GROUND_CELL; x <= box.x1; x += GROUND_CELL) {
    for (let z = Math.ceil(box.z0 / GROUND_CELL) * GROUND_CELL; z <= box.z1; z += GROUND_CELL) {
      const p = { x, z }
      if (buildingContains(selected, p)) continue
      if (Math.min(...rings.map((r) => distanceToRing(r, p))) > GROUND_REACH) continue
      let blocked = false
      for (const o of [...near, ...(selected.members ?? [])]) {
        if (buildingContains(o, p) || Math.min(distanceToRing(o.outer, p)) < GROUND_MARGIN) {
          blocked = true
          break
        }
      }
      if (blocked) continue
      out.push({ kind: 'ground', x, y: 0, z, azimuth, tilt: ROOF_TILT, size: GROUND_CELL, top: 0 })
    }
  }
  return out
}

/** Every candidate surface around `selected` (`buildings` is the whole scene, selected polygons included). */
export function surfaceSamples(selected: Building, buildings: Building[], lat: number): SurfaceSample[] {
  const ownIds = new Set(selected.sources ?? [selected.id])
  const others = buildings.filter((b) => !ownIds.has(b.id) && b.id !== selected.id)
  const azimuth = standAzimuth(lat)
  return [...facadeSamples(selected, others), ...roofSamples(selected, azimuth), ...groundSamples(selected, buildings, azimuth)]
}

const rad = (deg: number): number => (deg * Math.PI) / 180

/** Unit normal of a surface facing `azimuth`, tilted `tilt` from flat. */
function normalOf(azimuth: number, tilt: number): [number, number, number] {
  const f = facing(azimuth)
  return [Math.sin(rad(tilt)) * f.x, Math.cos(rad(tilt)), Math.sin(rad(tilt)) * f.z]
}

/** Where a sample's rays start and its normal: six numbers per sample (x, y, z, nx, ny, nz). */
export function rayInputs(samples: SurfaceSample[]): Float32Array {
  const out = new Float32Array(samples.length * 6)
  samples.forEach((s, i) => {
    const n = normalOf(s.azimuth, s.tilt)
    const lift = s.kind === 'facade' ? FACADE_LIFT : s.kind === 'roof' ? STAND_RISE : GROUND_ELEVATION + STAND_RISE
    // A facade sample is lifted along its normal; a stand's middle is straight above its cell.
    const origin =
      s.kind === 'facade' ? [s.x + n[0] * lift, s.y, s.z + n[2] * lift] : [s.x, s.y + lift, s.z]
    out.set([...origin, ...n], i * 6)
  })
  return out
}

/** Numbers per sample in a traced batch: beam, beam with nothing in the way, and diffuse, twelve months each. */
export const IRRADIATION_STRIDE = 36

/**
 * Traces samples `from` to `to` of `inputs` (see rayInputs): for each, the irradiation of the 21st of every month in
 * kWh/m2 as in panel-shade.ts (a slot counts when the sun is in front of the surface and the ray toward it is free;
 * diffuse is not shaded), written as beam[12], beamOpen[12], diffuse[12].
 */
export function traceSamples(bvh: MeshBVH, inputs: Float32Array, slots: YearSlots, step: number, from: number, to: number): Float32Array {
  const out = new Float32Array((to - from) * IRRADIATION_STRIDE)
  const ray = new Ray()
  const slotHours = step / 60
  const count = slots.start.length
  const sky = Array.from({ length: count }, (_, i) => clearSky((Math.asin(Math.min(1, slots.dirs[i * 3 + 1])) * 180) / Math.PI))
  for (let s = from; s < to; s++) {
    const at = s * 6
    const [nx, ny, nz] = [inputs[at + 3], inputs[at + 4], inputs[at + 5]]
    const tilt = (Math.acos(Math.min(1, Math.max(-1, ny))) * 180) / Math.PI
    ray.origin.set(inputs[at], inputs[at + 1], inputs[at + 2])
    const base = (s - from) * IRRADIATION_STRIDE
    for (let i = 0; i < count; i++) {
      const m = slots.month[i]
      const dx = slots.dirs[i * 3]
      const dy = slots.dirs[i * 3 + 1]
      const dz = slots.dirs[i * 3 + 2]
      out[base + 24 + m] += (diffuseOnPlane(sky[i], tilt) * slotHours) / 1000
      const cos = dx * nx + dy * ny + dz * nz
      if (cos <= 0) continue
      const beam = (sky[i].dni * cos * slotHours) / 1000
      out[base + 12 + m] += beam
      ray.direction.set(dx, dy, dz)
      if (!bvh.raycastFirst(ray, DoubleSide)) out[base + m] += beam
    }
  }
  return out
}

export interface SurfaceEnergy {
  /** kWh per kWp per year, ideal (clear sky) and with local weather (absent without climate data). */
  ideal: number
  weather?: number
  /** Share of the unshaded energy that shading takes, 0..1. */
  shadingShare: number
}

/** The figures of one traced sample: the same model as a panel card, per kWp (area x efficiency = 1 kW). */
export function surfaceEnergy(irradiation: Float32Array, at: number, assumptions: Assumptions = DEFAULT_ASSUMPTIONS, clearness?: number[]): SurfaceEnergy {
  const month = (offset: number): number[] => Array.from(irradiation.subarray(at + offset, at + offset + 12))
  const irr: EnergyIrradiation = { beam: month(0), beamOpen: month(12), diffuse: month(24) }
  const e = panelEnergy(irr, 1 / assumptions.efficiency, assumptions, DAYS_IN_MONTH, clearness)
  return { ideal: e.ideal, weather: e.weather, shadingShare: e.shadingShare }
}

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']
export const compass = (azimuth: number): string => COMPASS[Math.round((((azimuth % 360) + 360) % 360) / 45) % 8]

/** "Roof, 30° south" / "Facade facing south-west, 7 m up" / "Ground, 30° south". */
export function surfaceLabel(s: Pick<SurfaceSample, 'kind' | 'azimuth' | 'tilt' | 'y'>): string {
  if (s.kind === 'facade') return `Facade facing ${compass(s.azimuth)}, ${Math.round(s.y)} m up`
  return `${s.kind === 'roof' ? 'Roof' : 'Ground'}, ${s.tilt}° ${compass(s.azimuth)}`
}

/** The panel "Place a panel here" adds: the preset of the surface, one module at the spot. */
export function panelFor(s: SurfaceSample, id: string): Panel {
  const base = { id, ...DEFAULT_PANEL }
  if (s.kind === 'facade') {
    const n = facing(s.azimuth)
    const elevation = Math.max(0, Math.min(s.y - DEFAULT_PANEL.height / 2, s.top - DEFAULT_PANEL.height))
    return { ...base, x: s.x + n.x * FACADE_GAP, z: s.z + n.z * FACADE_GAP, elevation, tilt: 90, azimuth: s.azimuth }
  }
  return { ...base, x: s.x, z: s.z, elevation: s.kind === 'roof' ? s.top : GROUND_ELEVATION, tilt: ROOF_TILT, azimuth: s.azimuth }
}

/** Ramp end and legend ticks for these figures (kWh/kWp/yr): the top is the best spot rounded up to 250, ticks every 250 or 500. */
export function rampScale(values: ArrayLike<number>): { max: number; ticks: number[] } {
  let best = 0
  for (let i = 0; i < values.length; i++) best = Math.max(best, values[i])
  const max = Math.max(500, Math.ceil(best / 250) * 250)
  const step = max > 1250 ? 500 : 250
  const top = Math.ceil(max / step) * step
  return { max: top, ticks: Array.from({ length: top / step + 1 }, (_, i) => i * step) }
}

/** sRGB (0..1) of the sun-map ramp for a figure, `max` kWh/kWp/yr being its light end. */
export function suitabilityColor(kwh: number, max: number): [number, number, number] {
  return sunColor((Math.max(0, kwh) / max) * FULL_SUN_MINUTES).map((c) => c / 255) as [number, number, number]
}

const round10 = (n: number): string => (Math.round(n / 10) * 10).toLocaleString('en')

/** The popover's lines: the surface, the figure, and what it rests on. */
export function suitabilityText(s: SurfaceSample, e: SurfaceEnergy): { title: string; figure: string; detail: string } {
  const loss = e.shadingShare > 0 && e.shadingShare < 0.005 ? '<1%' : `${Math.round(e.shadingShare * 100)}%`
  const basis = e.weather === undefined ? 'clear sky, no weather data' : `with local weather (ideal ${round10(e.ideal)})`
  return {
    title: surfaceLabel(s),
    figure: `~${round10(e.weather ?? e.ideal)} kWh/kWp/yr`,
    detail: `${basis} · shading loss ${loss}`,
  }
}
