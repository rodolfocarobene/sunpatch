import type { Point } from './osm'
import { t, type Key } from './i18n'
import { plantById, plantName } from './plants'

/**
 * Furniture is decoration: it stands on the apartment floor in 3D and in the walk, but enters a computed number only when the
 * user counts it (see `occluderRoots` in sunmap-trace.ts). A piece is `x`/`z` (the centre of its footprint, plan metres) and `rot`
 * (degrees, turned like the plan on screen: positive is clockwise). Its front looks toward +z (south) at rot 0.
 */
export type FurnitureKind =
  | 'bed2' | 'bed1' | 'sofa' | 'armchair' | 'table' | 'chair' | 'desk' | 'wardrobe' | 'shelf' | 'counter' | 'rug' | 'plant'

export interface Furniture {
  kind: FurnitureKind
  x: number
  z: number
  /** Degrees clockwise in the plan, 0..360. */
  rot: number
  /** A potted plant of this species (a `plants.ts` id): the piece is a `plant` and is drawn and named after it. */
  plant?: string
  /** Height of the floor it stands on, scene metres. Only for what is not on the apartment floor (ground, roof, terrace): absent means that floor. */
  y?: number
}

export interface FurnitureSpec {
  kind: FurnitureKind
  /** Two letters, what a share link stores instead of the kind. */
  code: string
  /** Footprint along the piece's x (width) and z (depth), and its height, metres. */
  w: number
  d: number
  h: number
  name: Key
}

export const FURNITURE: readonly FurnitureSpec[] = [
  { kind: 'bed2', code: 'bd', w: 1.6, d: 2.0, h: 1.0, name: 'editor.furnBed2' },
  { kind: 'bed1', code: 'bs', w: 0.9, d: 2.0, h: 1.0, name: 'editor.furnBed1' },
  { kind: 'sofa', code: 'sf', w: 2.0, d: 0.9, h: 0.85, name: 'editor.furnSofa' },
  { kind: 'armchair', code: 'ac', w: 0.85, d: 0.85, h: 0.85, name: 'editor.furnArmchair' },
  { kind: 'table', code: 'tb', w: 1.6, d: 0.9, h: 0.75, name: 'editor.furnTable' },
  { kind: 'chair', code: 'ch', w: 0.45, d: 0.45, h: 0.9, name: 'editor.furnChair' },
  { kind: 'desk', code: 'dk', w: 1.2, d: 0.6, h: 0.75, name: 'editor.furnDesk' },
  { kind: 'wardrobe', code: 'wr', w: 1.2, d: 0.6, h: 2.0, name: 'editor.furnWardrobe' },
  { kind: 'shelf', code: 'bk', w: 0.8, d: 0.3, h: 1.8, name: 'editor.furnShelf' },
  { kind: 'counter', code: 'kc', w: 2.4, d: 0.6, h: 0.9, name: 'editor.furnCounter' },
  { kind: 'rug', code: 'rg', w: 2.0, d: 1.4, h: 0.01, name: 'editor.furnRug' },
  { kind: 'plant', code: 'pl', w: 0.4, d: 0.4, h: 1.2, name: 'editor.furnPlant' },
]

const BY_KIND = new Map<string, FurnitureSpec>(FURNITURE.map((s) => [s.kind, s]))
const BY_CODE = new Map<string, FurnitureSpec>(FURNITURE.map((s) => [s.code, s]))

export const isFurnitureKind = (v: unknown): v is FurnitureKind => typeof v === 'string' && BY_KIND.has(v)
export const specOf = (kind: FurnitureKind): FurnitureSpec => BY_KIND.get(kind)!

/** The rotate handle sits this far beyond the front of the piece. */
export const FURNITURE_TIP_DISTANCE = 0.5
/** Turning snaps to this many degrees; Shift turns in `FINE_STEP`s. */
export const ROTATE_STEP = 15
export const FINE_STEP = 5

/** A coordinate to the nearest 5 cm: what the editor keeps, so a share link (which stores 5 cm) loses nothing. */
export const snapMetres = (v: number): number => Math.round(v * 20) / 20

const rad = (deg: number): number => (deg * Math.PI) / 180

/** A direction in the piece's own frame (u along its width, v along its depth, front = +v) as plan (x, z). */
const toPlan = (f: Furniture, u: number, v: number): Point => {
  const c = Math.cos(rad(f.rot))
  const s = Math.sin(rad(f.rot))
  return { x: f.x + u * c - v * s, z: f.z + u * s + v * c }
}

/** The footprint's four corners in the plan, turned by `rot`. */
export function furnitureFootprint(f: Furniture): Point[] {
  const { w, d } = specOf(f.kind)
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => toPlan(f, (u * w) / 2, (v * d) / 2))
}

/** The rotate handle: in front of the piece. */
export function furnitureTip(f: Furniture): Point {
  return toPlan(f, 0, specOf(f.kind).d / 2 + FURNITURE_TIP_DISTANCE)
}

/** Rotation that puts the front of a piece at `from` toward `to`, degrees 0..360, snapped to `step` when given. */
export function rotationToward(from: Point, to: Point, step?: number): number {
  const deg = (Math.atan2(from.x - to.x, to.z - from.z) * 180) / Math.PI
  const snapped = step ? Math.round(deg / step) * step : deg
  return ((snapped % 360) + 360) % 360
}

/** True when `at` is on the footprint or within `tol` metres of it (measured in the piece's own frame, so a turned piece is exact). */
export function hitsFurniture(f: Furniture, at: Point, tol: number): boolean {
  const { w, d } = specOf(f.kind)
  const c = Math.cos(rad(f.rot))
  const s = Math.sin(rad(f.rot))
  const dx = at.x - f.x
  const dz = at.z - f.z
  return Math.abs(dx * c + dz * s) <= w / 2 + tol && Math.abs(-dx * s + dz * c) <= d / 2 + tol
}

/** What the plan editor calls a piece: the species of a potted plant, else its kind. */
export function furnitureName(f: Furniture): string {
  const plant = f.plant ? plantById(f.plant) : undefined
  return plant ? plantName(plant) : t(specOf(f.kind).name)
}

/** A pot of `plant` at a picked spot: snapped to 5 cm, with its height (to 10 cm, what a share link keeps) only when the spot is not on the apartment floor. */
export const potAt = (plant: string, at: Point & { y: number }, indoor: boolean): Furniture => ({
  kind: 'plant', x: snapMetres(at.x), z: snapMetres(at.z), rot: 0, plant, ...(!indoor && { y: Math.round(at.y * 10) / 10 }),
})

/** True when `list` already has a pot of `plant` where `pot` would stand. */
export const hasPot = (list: readonly Furniture[] | undefined, pot: Furniture): boolean =>
  !!list?.some((f) => f.plant === pot.plant && Math.hypot(f.x - pot.x, f.z - pot.z) < 0.06 && Math.abs((f.y ?? 0) - (pot.y ?? 0)) < 0.06)

export const newFurniture = (kind: FurnitureKind, at: Point): Furniture => ({ kind, x: at.x, z: at.z, rot: 0 })

const isPlantId = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9_-]{1,40}$/.test(v)

/** Checks the furniture of a parsed plan: `bad` when it is not a list of well-formed pieces. Pieces of an unknown kind are dropped. */
export function checkFurniture(raw: unknown): { furniture: Furniture[] } | { bad: true } {
  if (!Array.isArray(raw)) return { bad: true }
  const furniture: Furniture[] = []
  for (const f of raw as Partial<Furniture>[]) {
    if (!f || typeof f !== 'object' || ![f.x, f.z, f.rot].every((n) => typeof n === 'number' && Number.isFinite(n))) return { bad: true }
    if (!isFurnitureKind(f.kind)) continue
    const y = typeof f.y === 'number' && Number.isFinite(f.y) ? f.y : undefined
    furniture.push({ kind: f.kind, x: f.x!, z: f.z!, rot: f.rot!, ...(isPlantId(f.plant) && { plant: f.plant }), ...(y !== undefined && { y }) })
  }
  return { furniture }
}

/** Share links keep a position to 5 cm and a turn to 5 degrees. */
const POS_UNIT = 0.05
const ROT_UNIT = 5

/**
 * `[code, x, z, rot]` per piece, in 5 cm and 5 degree units: the compact form in a share link. A potted plant adds its
 * plant id, and a piece off the apartment floor its height in decimetres (after an empty id when there is no plant).
 */
export function packFurniture(list: readonly Furniture[]): (string | number)[][] {
  return list.map((f) => {
    const e: (string | number)[] = [specOf(f.kind).code, Math.round(f.x / POS_UNIT), Math.round(f.z / POS_UNIT), Math.round(f.rot / ROT_UNIT) % (360 / ROT_UNIT)]
    if (f.plant || f.y !== undefined) e.push(f.plant ?? '')
    if (f.y !== undefined) e.push(Math.round(f.y * 10))
    return e
  })
}

/** The pieces of a packed list; entries that are not understood (a newer kind, bad numbers) are skipped. */
export function unpackFurniture(raw: unknown): Furniture[] {
  if (!Array.isArray(raw)) return []
  const out: Furniture[] = []
  for (const e of raw) {
    if (!Array.isArray(e)) continue
    const [code, x, z, rot, plant, dm] = e as unknown[]
    const spec = typeof code === 'string' ? BY_CODE.get(code) : undefined
    if (!spec || ![x, z, rot].every((n) => typeof n === 'number' && Number.isFinite(n))) continue
    out.push({
      kind: spec.kind, x: Math.round((x as number) * POS_UNIT * 100) / 100, z: Math.round((z as number) * POS_UNIT * 100) / 100, rot: ((rot as number) * ROT_UNIT + 360) % 360,
      ...(isPlantId(plant) && { plant }), ...(typeof dm === 'number' && Number.isFinite(dm) && { y: dm / 10 }),
    })
  }
  return out
}
