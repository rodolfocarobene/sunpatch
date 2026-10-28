import type { OverpassElement } from './osm'

const ENDPOINT = 'https://overpass-api.de/api/interpreter'
export const RADIUS_M = 250

export async function fetchBuildingElements(
  lat: number,
  lon: number,
  radius = RADIUS_M,
): Promise<OverpassElement[]> {
  const around = `(around:${radius},${lat},${lon})`
  const query =
    `[out:json][timeout:25];(way["building"]${around};relation["building"]${around};` +
    `way["building:part"]${around};relation["building:part"]${around};);out geom;`
  let res: Response
  try {
    res = await fetch(ENDPOINT, { method: 'POST', body: new URLSearchParams({ data: query }) })
  } catch {
    throw new Error('Network error while contacting Overpass. Check your connection and retry.')
  }
  if (!res.ok) {
    throw new Error(
      res.status === 429 || res.status >= 500
        ? 'The Overpass server is busy, try again in a few seconds.'
        : `Overpass request failed (HTTP ${res.status}).`,
    )
  }
  const json = (await res.json()) as { elements?: OverpassElement[] }
  return json.elements ?? []
}
