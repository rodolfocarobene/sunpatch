import polygonClipping, { type MultiPolygon, type Polygon } from 'polygon-clipping'

export interface Point {
  x: number
  z: number
}

export interface Origin {
  lat: number
  lon: number
}

export type HeightSource = 'tag' | 'levels' | 'default' | 'tile' | 'parts' | 'user'

export interface Building {
  /** e.g. "way/123", "relation/45" or "relation/45#2" when a relation has several outer rings. */
  id: string
  outer: Point[]
  holes: Point[][]
  minHeight: number
  height: number
  heightSource: HeightSource
  levels?: number
  /** Set when the user's own height replaced the data (heights.ts): what the data said, for the label and Reset. */
  dataHeight?: { height: number; heightSource: HeightSource }
  tags: Record<string, string>
  /**
   * Set on a selection made of several OSM polygons (see block.ts): `outer`/`holes` are their union and
   * the heights summarise them. The pieces that are drawn keep their own footprint and heights; `sources`
   * lists the ids of every polygon merged in, including outlines that are only a footprint for their parts.
   */
  members?: Building[]
  sources?: string[]
  /** On a merged selection: the id of the polygon the user clicked (it cannot be removed from the selection). */
  anchor?: string
  /** On a merged selection: the fill stopped at its size cap, so the selection may be incomplete. */
  capped?: boolean
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

/** Distance from p to the closest edge of the ring. */
export function distanceToRing(ring: Point[], p: Point): number {
  let d = Infinity
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j]
    const b = ring[i]
    const len2 = (b.x - a.x) ** 2 + (b.z - a.z) ** 2
    const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.z - a.z) * (b.z - a.z)) / len2)) : 0
    d = Math.min(d, Math.hypot(a.x + t * (b.x - a.x) - p.x, a.z + t * (b.z - a.z) - p.z))
  }
  return d
}

export const MAX_SNAP_M = 20

/** The building containing p (see pickBuilding), else the nearest one within MAX_SNAP_M. */
export function snapBuilding(buildings: Building[], p: Point): Building | undefined {
  const inside = pickBuilding(buildings, p)
  if (inside) return inside
  let best: Building | undefined
  let bestDist = MAX_SNAP_M
  for (const b of buildings) {
    const d = distanceToRing(b.outer, p)
    if (d < bestDist) {
      best = b
      bestDist = d
    }
  }
  return best
}

const isPart = (b: Building) => 'building:part' in b.tags

/** Parts of `outline`: `building:part` pieces whose centroid lies inside it. */
export function partsOf(outline: Building, buildings: Building[]): Building[] {
  return buildings.filter((b) => isPart(b) && buildingContains(outline, ringCentroid(b.outer)))
}

/** Parts must cover at least this share of an outline for the outline to be only their footprint. */
export const PARTS_COVER_SHARE = 0.9

/** The parts (a part tag, centroid inside) together cover most of the outline's area. */
export function partsCover(outline: Building, parts: Building[]): boolean {
  if (parts.length === 0) return false
  const pairs = (r: Point[]): [number, number][] => r.map((p) => [p.x, p.z])
  const polygon = (b: Building): Polygon => [pairs(b.outer), ...b.holes.map(pairs)]
  const ring = (r: [number, number][]) => ringArea(r.map(([x, z]) => ({ x, z })))
  const area = (multi: MultiPolygon) =>
    multi.reduce((sum, [outer, ...holes]) => sum + ring(outer) - holes.reduce((h, r) => h + ring(r), 0), 0)
  const own = area([polygon(outline)])
  if (own < 1e-6) return true
  const union = polygonClipping.union(polygon(parts[0]), ...parts.slice(1).map(polygon))
  return area(polygonClipping.intersection(polygon(outline), union)) / own >= PARTS_COVER_SHARE
}

/**
 * OSM Simple 3D Buildings: an outline whose parts cover it is only a footprint and must not be rendered,
 * otherwise it overlaps (z-fights with) its parts. An outline the parts only partly cover (a tower part on a
 * podium that is mapped as the outline alone) is a building in its own right and stays.
 */
export function hiddenOutlines(buildings: Building[]): Set<string> {
  return new Set(
    buildings.filter((b) => !isPart(b) && partsCover(b, partsOf(b, buildings))).map((b) => b.id),
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

/**
 * An outline with no height of its own (the 9 m default) that carries parts floating above it, such as the
 * Duomo's spires on a body that is only mapped as the outline: whatever lies under the lowest floating part
 * has to be the outline, so it is raised to that height instead of leaving the parts hanging over a low box.
 */
export function inferBodyHeights(buildings: Building[]): void {
  const parts = buildings.filter(isPart)
  for (const outline of buildings) {
    if (isPart(outline) || outline.heightSource !== 'default') continue
    const inside = partsOf(outline, parts)
    // A part is held up when a held-up part under it (or one from the ground) spans at least half its footprint.
    const held = new Set<Building>(inside.filter((p) => p.minHeight === 0))
    for (const p of [...inside].sort((x, y) => x.minHeight - y.minHeight)) {
      const at = ringCentroid(p.outer)
      const base = [...held].some(
        (q) => q.minHeight < p.minHeight && q.height >= p.minHeight && ringArea(q.outer) >= ringArea(p.outer) / 2 && buildingContains(q, at),
      )
      if (base) held.add(p)
    }
    const floating = inside.filter((p) => !held.has(p))
    if (floating.length === 0) continue
    const body = Math.min(...floating.map((p) => p.minHeight))
    if (body <= outline.height) continue
    outline.height = body
    outline.heightSource = 'parts'
  }
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
  inferBodyHeights(buildings)
  return { buildings, skippedRings }
}
