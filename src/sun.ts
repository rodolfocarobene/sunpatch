import SunCalc from 'suncalc'

export interface SunDirection {
  /** Degrees clockwise from north (0 = N, 90 = E, 180 = S). */
  azimuthDeg: number
  /** Degrees above the horizon (negative = below). */
  altitudeDeg: number
  /** Unit vector from the scene toward the sun; x = east, y = up, z = south. */
  vector: { x: number; y: number; z: number }
}

const RAD = Math.PI / 180

export function sunDirection(date: Date, lat: number, lon: number): SunDirection {
  const { azimuth, altitude } = SunCalc.getPosition(date, lat, lon)
  // SunCalc azimuth is radians from SOUTH, positive toward WEST. Scene: +x east, +z south,
  // so the horizontal components are east = -sin(az), south = cos(az).
  const cosAlt = Math.cos(altitude)
  const vector = {
    x: -Math.sin(azimuth) * cosAlt,
    y: Math.sin(altitude),
    z: Math.cos(azimuth) * cosAlt,
  }
  const azimuthDeg = (((azimuth / RAD + 180) % 360) + 360) % 360
  return { azimuthDeg, altitudeDeg: altitude / RAD, vector }
}
