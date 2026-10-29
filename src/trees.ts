import {
  Color,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three'
import {
  distanceToRing,
  pointInPolygon,
  project,
  stitchRings,
  type Building,
  type Origin,
  type OverpassElement,
  type Point,
} from './osm'

export interface Tree {
  x: number
  z: number
  /** Total height in metres. */
  height: number
  /** Canopy radius in metres. */
  crown: number
  /** 0..1, picks the green of this tree. */
  shade: number
}

export interface GreenArea {
  id: string
  outer: Point[]
  holes: Point[][]
  /** Wanted distance between trees, metres. */
  spacing: number
}

export interface Green {
  areas: GreenArea[]
  /** Trees mapped one by one (`natural=tree`, `natural=tree_row`): placed exactly. */
  trees: Tree[]
}

/** Trees farther than this from the origin are skipped: the wide shadow map reaches about 280 m. */
export const TREE_RADIUS_M = 300
export const MAX_TREES = 1500
/** Scattered trees stay this far from walls, so canopies neither enter the apartment nor block a window. */
export const BUILDING_MARGIN_M = 4
const ROW_SPACING_M = 7
const MIN_HEIGHT = 6
const MAX_HEIGHT = 14

/** Wood is dense, park and garden medium, plain grass sparse. */
function spacingOf(tags: Record<string, string>): number | undefined {
  if (tags.natural === 'wood' || tags.landuse === 'forest') return 6
  if (tags.leisure === 'park') return 9
  if (tags.leisure === 'garden' || tags.natural === 'scrub') return 10
  if (['grass', 'meadow', 'village_green'].includes(tags.landuse)) return 13
  return undefined
}

// --- seeded randomness -------------------------------------------------------------------------

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/** mulberry32, seeded from a string. */
export function seededRandom(seed: string): () => number {
  let a = hash(seed)
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeTree(x: number, z: number, rand: () => number, mappedHeight?: number): Tree {
  const height = mappedHeight ?? MIN_HEIGHT + (MAX_HEIGHT - MIN_HEIGHT) * rand() ** 1.3
  return { x, z, height, crown: height * (0.26 + 0.1 * rand()), shade: rand() }
}

// --- parsing -----------------------------------------------------------------------------------

type LatLon = { lat: number; lon: number }

const heightTag = (tags: Record<string, string>) => {
  const h = parseFloat(tags.height ?? '')
  return Number.isFinite(h) ? Math.min(25, Math.max(3, h)) : undefined
}

/** Green areas and mapped trees from Overpass elements (the same answer as the buildings). */
export function parseGreen(elements: OverpassElement[], origin: Origin): Green {
  const areas: GreenArea[] = []
  const trees: Tree[] = []
  const toLocal = (ring: LatLon[], closed: boolean): Point[] =>
    (closed ? ring.slice(0, -1) : ring).map((n) => project(n.lat, n.lon, origin))
  const isClosed = (g: LatLon[]) => g.length >= 4 && g[0].lat === g[g.length - 1].lat && g[0].lon === g[g.length - 1].lon

  for (const el of elements) {
    const tags = el.tags ?? {}
    if (el.type === 'node') {
      const n = el as unknown as LatLon
      if (tags.natural !== 'tree' || !Number.isFinite(n.lat)) continue
      const p = project(n.lat, n.lon, origin)
      trees.push(makeTree(p.x, p.z, seededRandom(`node/${el.id}`), heightTag(tags)))
    } else if (el.type === 'way' && tags.natural === 'tree_row' && el.geometry) {
      const line = toLocal(el.geometry, false)
      const rand = seededRandom(`way/${el.id}`)
      let next = 0 // distance along the line of the next tree
      let start = 0 // distance along the line where the current segment starts
      for (let i = 0; i + 1 < line.length; i++) {
        const a = line[i]
        const b = line[i + 1]
        const len = Math.hypot(b.x - a.x, b.z - a.z)
        for (; next <= start + len; next += ROW_SPACING_M) {
          const t = len ? (next - start) / len : 0
          trees.push(makeTree(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, rand, heightTag(tags)))
        }
        start += len
      }
    } else {
      const spacing = spacingOf(tags)
      if (!spacing) continue
      if (el.type === 'way') {
        if (el.geometry && isClosed(el.geometry)) {
          areas.push({ id: `way/${el.id}`, outer: toLocal(el.geometry, true), holes: [], spacing })
        }
      } else if (el.type === 'relation') {
        const segs = (role: string) =>
          (el.members ?? []).filter((m) => m.type === 'way' && m.role === role && m.geometry).map((m) => m.geometry as LatLon[])
        const outers = stitchRings(segs('outer')).rings.map((r) => toLocal(r, true))
        const holes = stitchRings(segs('inner')).rings.map((r) => toLocal(r, true))
        outers.forEach((outer, i) =>
          areas.push({
            id: `relation/${el.id}#${i}`,
            outer,
            holes: holes.filter((h) => pointInPolygon(h[0], outer)),
            spacing,
          }),
        )
      }
    }
  }
  return { areas, trees }
}

// --- scatter -----------------------------------------------------------------------------------

export function inArea(a: Pick<GreenArea, 'outer' | 'holes'>, p: Point): boolean {
  return pointInPolygon(p, a.outer) && !a.holes.some((h) => pointInPolygon(p, h))
}

interface Blocker {
  outer: Point[]
  holes: Point[][]
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

const bounds = (ring: Point[]) => {
  const xs = ring.map((p) => p.x)
  const zs = ring.map((p) => p.z)
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) }
}

function blockers(buildings: Pick<Building, 'outer' | 'holes'>[], margin: number): Blocker[] {
  return buildings.map((b) => {
    const r = bounds(b.outer)
    return { outer: b.outer, holes: b.holes, minX: r.minX - margin, maxX: r.maxX + margin, minZ: r.minZ - margin, maxZ: r.maxZ + margin }
  })
}

/** Inside a building, or closer than `margin` to one of its walls (courtyard walls included). */
function blocked(list: Blocker[], p: Point, margin: number): boolean {
  for (const b of list) {
    if (p.x < b.minX || p.x > b.maxX || p.z < b.minZ || p.z > b.maxZ) continue
    if (pointInPolygon(p, b.outer) && !b.holes.some((h) => pointInPolygon(p, h))) return true
    if (distanceToRing(b.outer, p) < margin || b.holes.some((h) => distanceToRing(h, p) < margin)) return true
  }
  return false
}

export interface ScatterOptions {
  maxTrees?: number
  radius?: number
  margin?: number
}

/**
 * Mapped trees as they are, then dart throwing inside each green area: random points are kept when they
 * are inside the polygon (not in a hole), clear of buildings and at least `spacing` from every other tree.
 * Candidates are drawn in the area's bounding box from a generator seeded with the area id, so
 * an area gets the same trees (up to the origin shift) whichever building is the origin. The nearest areas fill the budget first.
 */
export function scatterTrees(
  green: Green,
  buildings: Pick<Building, 'outer' | 'holes'>[],
  options: ScatterOptions = {},
): Tree[] {
  const { maxTrees = MAX_TREES, radius = TREE_RADIUS_M, margin = BUILDING_MARGIN_M } = options
  const near = (x: number, z: number) => Math.hypot(x, z) <= radius
  const out: Tree[] = green.trees.filter((t) => near(t.x, t.z)).slice(0, maxTrees)
  const list = blockers(buildings, margin)
  const areas = green.areas
    .map((a) => {
      const r = bounds(a.outer)
      return { a, r, d: Math.hypot((r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2) }
    })
    .sort((p, q) => p.d - q.d || (p.a.id < q.a.id ? -1 : 1))

  for (const { a, r } of areas) {
    if (out.length >= maxTrees) break
    const cell = a.spacing
    const rand = seededRandom(a.id)
    // Spatial hash of the trees placed so far (mapped ones and other areas' too), one cell per spacing.
    const grid = new Map<string, Tree[]>()
    const key = (x: number, z: number) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`
    const put = (t: Tree) => {
      const k = key(t.x, t.z)
      const cellTrees = grid.get(k)
      if (cellTrees) cellTrees.push(t)
      else grid.set(k, [t])
    }
    for (const t of out) if (t.x > r.minX - cell && t.x < r.maxX + cell && t.z > r.minZ - cell && t.z < r.maxZ + cell) put(t)
    const clear = (x: number, z: number) => {
      const cx = Math.floor(x / cell)
      const cz = Math.floor(z / cell)
      for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
          for (const t of grid.get(`${cx + i},${cz + j}`) ?? []) if (Math.hypot(t.x - x, t.z - z) < cell) return false
        }
      }
      return true
    }
    const attempts = Math.min(40000, Math.ceil(((r.maxX - r.minX) * (r.maxZ - r.minZ)) / (cell * cell)) * 8)
    for (let i = 0; i < attempts && out.length < maxTrees; i++) {
      const p = {
        x: r.minX + (r.maxX - r.minX) * rand(),
        z: r.minZ + (r.maxZ - r.minZ) * rand(),
      }
      const tree = makeTree(p.x, p.z, rand)
      if (!near(p.x, p.z) || !inArea(a, p) || !clear(p.x, p.z) || blocked(list, p, margin)) continue
      out.push(tree)
      put(tree)
    }
  }
  return out
}

// --- rendering ---------------------------------------------------------------------------------

// Muted greens that sit on the warm plaster and grey-green ground of the scene.
const CANOPY = new Color(0x62804f)
const TRUNK = new Color(0x6a5a48)

/** Two InstancedMeshes (trunks, canopies); both cast and receive shadows from the wide sun light. */
export function buildTreeGroup(trees: Tree[]): Group {
  const group = new Group()
  group.name = 'trees'
  if (!trees.length) return group
  const trunk = new CylinderGeometry(0.6, 1, 1, 6)
  trunk.translate(0, 0.5, 0)
  const trunks = new InstancedMesh(trunk, new MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), trees.length)
  const canopies = new InstancedMesh(
    new IcosahedronGeometry(1, 1),
    new MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }),
    trees.length,
  )
  const m = new Matrix4()
  const q = new Quaternion()
  const color = new Color()
  trees.forEach((t, i) => {
    const trunkH = t.height * 0.42
    const crownH = (t.height - trunkH * 0.7) / 2
    const trunkR = 0.12 + t.height * 0.012
    const s = t.shade - 0.5
    trunks.setMatrixAt(i, m.compose(new Vector3(t.x, 0, t.z), q, new Vector3(trunkR, trunkH, trunkR)))
    trunks.setColorAt(i, color.copy(TRUNK).offsetHSL(0, 0, s * 0.06))
    canopies.setMatrixAt(i, m.compose(new Vector3(t.x, t.height - crownH, t.z), q, new Vector3(t.crown, crownH, t.crown)))
    canopies.setColorAt(i, color.copy(CANOPY).offsetHSL(s * 0.05, s * 0.1, s * 0.1))
  })
  for (const mesh of [trunks, canopies]) {
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
  }
  return group
}

export function disposeTreeGroup(group: Group) {
  for (const mesh of group.children as InstancedMesh[]) {
    mesh.geometry.dispose()
    ;(mesh.material as MeshStandardMaterial).dispose()
    mesh.dispose()
  }
  group.clear()
}
