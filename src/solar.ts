// Clear-sky irradiance and the energy of a panel. Simple, standard models: the beam from an air-mass law (Meinel),
// air mass from Kasten and Young, diffuse as a fixed share of the beam. Direct sun is traced in 3D by panel-shade.ts;
// everything here is the sky above it.

const RAD = Math.PI / 180

/** Solar constant used by the Meinel law, W/m2. */
export const SOLAR_CONSTANT = 1353
/** Meinel atmospheric transmittance at one air mass; 0.7 is a very clean sky, 0.68 is a typical European one (it brings the clear-sky horizontal totals to NASA POWER's). */
export const TRANSMITTANCE = 0.68
/** Clear-sky diffuse on the horizontal plane, as a share of the beam normal irradiance (ASHRAE's C is about 0.1). */
export const DIFFUSE_SHARE = 0.1
/** Reflectance of the ground in front of the panel. */
export const ALBEDO = 0.2
export const DEFAULT_EFFICIENCY = 0.21
export const DEFAULT_LOSSES = 0.14

/** Relative air mass, Kasten and Young (1989), for a sun altitude in degrees above the horizon. */
export const airMass = (altitudeDeg: number): number => 1 / (Math.sin(altitudeDeg * RAD) + 0.50572 * Math.pow(altitudeDeg + 6.07995, -1.6364))

export interface ClearSky {
  /** Beam normal irradiance, W/m2. */
  dni: number
  /** Diffuse horizontal irradiance, W/m2. */
  dhi: number
  /** Global horizontal irradiance, W/m2. */
  ghi: number
}

/** Clear-sky irradiance for a sun altitude in degrees (zero at or below the horizon). */
export function clearSky(altitudeDeg: number): ClearSky {
  if (altitudeDeg <= 0) return { dni: 0, dhi: 0, ghi: 0 }
  const dni = SOLAR_CONSTANT * Math.pow(TRANSMITTANCE, Math.pow(airMass(altitudeDeg), 0.678))
  const dhi = DIFFUSE_SHARE * dni
  return { dni, dhi, ghi: dni * Math.sin(altitudeDeg * RAD) + dhi }
}

/** Isotropic diffuse on a plane tilted `tiltDeg`: sky diffuse plus light reflected by the ground, W/m2. */
export function diffuseOnPlane(sky: ClearSky, tiltDeg: number): number {
  const c = Math.cos(tiltDeg * RAD)
  return (sky.dhi * (1 + c)) / 2 + (sky.ghi * ALBEDO * (1 - c)) / 2
}

export interface Assumptions {
  /** Module efficiency, 0..1. */
  efficiency: number
  /** System losses (wiring, inverter, heat, dirt), 0..1. */
  losses: number
}

export const DEFAULT_ASSUMPTIONS: Assumptions = { efficiency: DEFAULT_EFFICIENCY, losses: DEFAULT_LOSSES }

/** Peak power of the panel, kW: area x efficiency x 1 kW/m2. */
export const kilowattPeak = (area: number, a: Assumptions): number => area * a.efficiency

export interface EnergyIrradiation {
  /** Per month, kWh/m2 on the representative day: beam on the lit part of the face. */
  beam: number[]
  /** The same with nothing in the way. */
  beamOpen: number[]
  /** Per month, kWh/m2 on the representative day: sky and ground diffuse (not shaded). */
  diffuse: number[]
}

export interface PanelEnergy {
  /** Peak power, kW. */
  kwp: number
  /** Ideal clear-sky energy per month, kWh. */
  monthIdeal: number[]
  /** Weather-weighted per month, kWh (absent without climate data). */
  monthWeather?: number[]
  ideal: number
  weather?: number
  /** Ideal with no obstacles, and what shading costs, kWh a year. */
  idealOpen: number
  shadingCost: number
  /** Shading cost as a share of the open figure, 0..1. */
  shadingShare: number
}

/**
 * Turns the irradiation of the representative days into kWh: months scaled by their days, times area, efficiency and
 * the performance ratio (1 - losses). `clearness` is the monthly all-sky / clear-sky ratio, when known.
 */
export function panelEnergy(irr: EnergyIrradiation, area: number, a: Assumptions, daysInMonth: number[], clearness?: number[]): PanelEnergy {
  const factor = area * a.efficiency * (1 - a.losses)
  const month = (beam: number[]): number[] => beam.map((b, m) => (b + irr.diffuse[m]) * daysInMonth[m] * factor)
  const sum = (v: number[]): number => v.reduce((s, x) => s + x, 0)
  const monthIdeal = month(irr.beam)
  const ideal = sum(monthIdeal)
  const idealOpen = sum(month(irr.beamOpen))
  const monthWeather = clearness ? monthIdeal.map((e, m) => e * clearness[m]) : undefined
  return {
    kwp: kilowattPeak(area, a),
    monthIdeal,
    monthWeather,
    ideal,
    weather: monthWeather ? sum(monthWeather) : undefined,
    idealOpen,
    shadingCost: Math.max(0, idealOpen - ideal),
    shadingShare: idealOpen > 0 ? Math.max(0, 1 - ideal / idealOpen) : 0,
  }
}
