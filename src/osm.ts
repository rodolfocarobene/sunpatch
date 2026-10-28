export interface Point {
  x: number
  z: number
}

export interface Origin {
  lat: number
  lon: number
}

export type HeightSource = 'tag' | 'levels' | 'default'

export interface Building {
  /** e.g. "way/123", "relation/45" or "relation/45#2" when a relation has several outer rings. */
  id: string
  outer: Point[]
  holes: Point[][]
  minHeight: number
  height: number
  heightSource: HeightSource
  levels?: number
  tags: Record<string, string>
}

interface LatLon {
  lat: number
  lon: number
}

export interface OverpassMember {
  type: string
  ref: number
  role: string
  geometry?: LatLon[] | null
}

export interface OverpassElement {
  type: 'way' | 'relation' | 'node'
  id: number
  tags?: Record<string, string>
  geometry?: LatLon[]
  members?: OverpassMember[]
}

const K = (Math.PI / 180) * 6371008.8
const LEVEL_HEIGHT = 3
const DEFAULT_HEIGHT = 9

export function project(lat: number, lon: number, origin: Origin): Point {
  return {
    x: (lon - origin.lon) * Math.cos((origin.lat * Math.PI) / 180) * K,
    z: -(lat - origin.lat) * K,
  }
}

export function unproject(p: Point, origin: Origin): Origin {
  return {
    lat: origin.lat - p.z / K,
    lon: origin.lon + p.x / (Math.cos((origin.lat * Math.PI) / 180) * K),
  }
}

/** Ray casting; points exactly on an edge may fall either way. */
export function pointInPolygon(p: Point, ring: Point[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) {
      inside = !inside
    }
  }
  return inside
}

export function buildingContains(b: Building, p: Point): boolean {
  return pointInPolygon(p, b.outer) && !b.holes.some((h) => pointInPolygon(p, h))
}

/** Prefers whole `building` outlines over `building:part` pieces, then the smallest footprint. */
export function pickBuilding(buildings: Building[], p: Point): Building | undefined {
  const hits = buildings.filter((b) => buildingContains(b, p))
  hits.sort(
    (a, b) =>
      Number('building' in b.tags) - Number('building' in a.tags) ||
      ringArea(a.outer) - ringArea(b.outer),
  )
  return hits[0]
}

const isPart = (b: Building) => 'building:part' in b.tags

/** Parts of `outline`: `building:part` pieces whose centroid lies inside it. */
export function partsOf(outline: Building, buildings: Building[]): Building[] {
  return buildings.filter((b) => isPart(b) && buildingContains(outline, ringCentroid(b.outer)))
}

/**
 * OSM Simple 3D Buildings: an outline that has parts is only a footprint and must not be
 * rendered, otherwise it overlaps (z-fights with) its parts.
 */
export function hiddenOutlines(buildings: Building[]): Set<string> {
  return new Set(
    buildings.filter((b) => !isPart(b) && partsOf(b, buildings).length > 0).map((b) => b.id),
  )
}

export function ringArea(ring: Point[]): number {
  let s = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    s += ring[j].x * ring[i].z - ring[i].x * ring[j].z
  }
  return Math.abs(s) / 2
}

export function ringCentroid(ring: Point[]): Point {
  let a = 0
  let cx = 0
  let cz = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j].x * ring[i].z - ring[i].x * ring[j].z
    a += f
    cx += (ring[j].x + ring[i].x) * f
    cz += (ring[j].z + ring[i].z) * f
  }
  if (Math.abs(a) < 1e-9) return ring[0]
  return { x: cx / (3 * a), z: cz / (3 * a) }
}

/** Parses "12", "12 m", "12.5m"; returns undefined for anything else. */
export function parseLength(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const m = /^\s*(\d+(?:\.\d+)?)\s*(?:m)?\s*$/i.exec(value)
  if (!m) return undefined
  const n = Number(m[1])
  return Number.isFinite(n) ? n : undefined
}

function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined || !/^\s*\d+(\.\d+)?\s*$/.test(value)) return undefined
  return Number(value)
}

export function buildingHeights(tags: Record<string, string>): {
  height: number
  heightSource: HeightSource
  minHeight: number
  levels?: number
} {
  const levels = parseNumber(tags['building:levels'])
  let height = DEFAULT_HEIGHT
  let heightSource: HeightSource = 'default'
  const tagged = parseLength(tags.height)
  if (tagged !== undefined && tagged > 0) {
    height = tagged
    heightSource = 'tag'
  } else if (levels !== undefined && levels > 0) {
    height = levels * LEVEL_HEIGHT
    heightSource = 'levels'
  }
  const minLevel = parseNumber(tags['building:min_level'])
  let minHeight = parseLength(tags.min_height) ?? (minLevel !== undefined ? minLevel * LEVEL_HEIGHT : 0)
  if (minHeight >= height) minHeight = 0
  return { height, heightSource, minHeight, ...(levels !== undefined ? { levels } : {}) }
}

const sameNode = (a: LatLon, b: LatLon) => a.lat === b.lat && a.lon === b.lon

function isClosed(g: LatLon[]): boolean {
  return g.length >= 4 && sameNode(g[0], g[g.length - 1])
}

/** Joins way segments end-to-end into closed rings; segments that cannot be closed are dropped. */
export function stitchRings(segments: LatLon[][]): { rings: LatLon[][]; skipped: number } {
  const pending = segments.filter((s) => s.length >= 2).map((s) => s.slice())
  const rings: LatLon[][] = []
  let skipped = 0
  while (pending.length) {
    let ring = pending.pop()!
    while (!isClosed(ring)) {
      const end = ring[ring.length - 1]
      const idx = pending.findIndex((s) => sameNode(s[0], end) || sameNode(s[s.length - 1], end))
      if (idx < 0) break
      const next = pending.splice(idx, 1)[0]
      if (!sameNode(next[0], end)) next.reverse()
      ring = ring.concat(next.slice(1))
    }
    if (isClosed(ring)) rings.push(ring)
    else skipped++
  }
  return { rings, skipped }
}

export interface ParseResult {
  buildings: Building[]
  /** Relation outer/inner rings, or ways, that could not be closed. */
  skippedRings: number
}

export function parseOverpass(elements: OverpassElement[], origin: Origin): ParseResult {
  const buildings: Building[] = []
  let skippedRings = 0
  const toLocal = (ring: LatLon[]): Point[] =>
    ring.slice(0, -1).map((n) => project(n.lat, n.lon, origin))

  for (const el of elements) {
    const tags = el.tags ?? {}
    if (!('building' in tags) && !('building:part' in tags)) continue
    const info = buildingHeights(tags)

    if (el.type === 'way') {
      if (!el.geometry || !isClosed(el.geometry)) {
        skippedRings++
        continue
      }
      buildings.push({ id: `way/${el.id}`, outer: toLocal(el.geometry), holes: [], ...info, tags })
    } else if (el.type === 'relation') {
      const segs = (role: string) =>
        (el.members ?? [])
          .filter((m) => m.type === 'way' && m.role === role && m.geometry)
          .map((m) => m.geometry as LatLon[])
      const outers = stitchRings(segs('outer'))
      const inners = stitchRings(segs('inner'))
      skippedRings += outers.skipped + inners.skipped
      const holes = inners.rings.map(toLocal)
      outers.rings.forEach((ring, i) => {
        const outer = toLocal(ring)
        buildings.push({
          id: outers.rings.length > 1 ? `relation/${el.id}#${i + 1}` : `relation/${el.id}`,
          outer,
          holes: holes.filter((h) => pointInPolygon(h[0], outer)),
          ...info,
          tags,
        })
      })
    }
  }
  return { buildings, skippedRings }
}
