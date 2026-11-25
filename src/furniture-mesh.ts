import { BoxGeometry, CylinderGeometry, Group, IcosahedronGeometry, Mesh, MeshStandardMaterial, type BufferGeometry } from 'three'
import { sizeOf, type Furniture, type FurnitureKind } from './furniture'
import { plantById, type Plant, type PlantForm } from './plants'
import { TROUGH_HEIGHT } from './wall-mount'

// Muted, warm colours that sit with the scene palette (scene.ts): oak and walnut, linen, sage, clay.
const OAK = 0xb98f63
const WALNUT = 0x8a6644
const LINEN = 0xe4dac6
const CREAM = 0xf0e8d8
const SAGE = 0x9aa88a
const CLAY = 0xc48f73
const SLATE = 0x6c7783
const STONE = 0x9a968c
const RUG = 0x8fa6a0
const LEAF = 0x6f8f5a
const LEAF_LIGHT = 0x88a56c
const POT = 0xb8704f
const SOIL = 0x4a3a2c
const LEAF_DEEP = 0x3f6b45
const LEAF_DARK = 0x56804f
const FRUIT = 0xc9573f
const SUCCULENT = 0x7f9f8a
const SUCCULENT_LIGHT = 0x9fbaa2
const SWORD = 0x6b8a4e
// Warm blooms of a flowering pot: one per plant, picked by its id.
const BLOOMS = [0xd6553f, 0xe8913a, 0xe8c547, 0xd9708c]
const BOOKS = [0xb5513f, 0x4f6d7a, 0xd2a64a, 0x6a7f55, 0x8a5a7a]

const materials = new Map<number, MeshStandardMaterial>()
const material = (color: number): MeshStandardMaterial => {
  let m = materials.get(color)
  if (!m) materials.set(color, (m = new MeshStandardMaterial({ color, roughness: 0.85 })))
  return m
}

// One unit shape each; a part scales it, so every piece of furniture shares these three geometries.
const BOX = new BoxGeometry(1, 1, 1)
const CYLINDER = new CylinderGeometry(0.5, 0.5, 1, 8)
const BLOB = new IcosahedronGeometry(0.5, 0)

interface Part {
  geometry: BufferGeometry
  /** Footprint centre (x, z) and the bottom (y) of the part, then its size (x, y, z). */
  at: [number, number, number]
  size: [number, number, number]
  color: number
  castShadow?: boolean
}

const box = (x: number, y: number, z: number, w: number, h: number, d: number, color: number): Part => ({ geometry: BOX, at: [x, y, z], size: [w, h, d], color })
const cyl = (x: number, y: number, z: number, w: number, h: number, d: number, color: number): Part => ({ geometry: CYLINDER, at: [x, y, z], size: [w, h, d], color })
const blob = (x: number, y: number, z: number, w: number, h: number, d: number, color: number): Part => ({ geometry: BLOB, at: [x, y, z], size: [w, h, d], color })

/** Four legs of `h` under a w x d footprint, `inset` in from each corner. */
const legs = (w: number, d: number, h: number, size: number, inset: number, color: number): Part[] =>
  [-1, 1].flatMap((u) => [-1, 1].map((v) => box(u * (w / 2 - inset), 0, v * (d / 2 - inset), size, h, size, color)))

// Local frame: x across, z deep with the front toward +z, y up from the floor, centred on the footprint.
const bed = (w: number, d: number, pillows: number): Part[] => {
  const pw = (w - 0.2) / pillows
  return [
    box(0, 0, 0, w, 0.35, d, OAK),
    box(0, 0.35, 0.04, w - 0.06, 0.2, d - 0.1, LINEN),
    box(0, 0.55, d * 0.18, w - 0.04, 0.05, d * 0.6, SAGE),
    box(0, 0, -d / 2 + 0.03, w, 1, 0.06, WALNUT),
    ...Array.from({ length: pillows }, (_, i) => box((i - (pillows - 1) / 2) * (pw + 0.05), 0.55, -d / 2 + 0.3, pw, 0.12, 0.38, CREAM)),
  ]
}

const sofa = (w: number, d: number, seats: number): Part[] => {
  const seat = (w - 0.3) / seats
  return [
    ...legs(w, d, 0.1, 0.07, 0.06, WALNUT),
    box(0, 0.1, 0, w, 0.3, d, CLAY),
    box(0, 0.4, -d / 2 + 0.11, w, 0.45, 0.22, CLAY),
    box(-w / 2 + 0.08, 0.4, 0.1, 0.16, 0.25, d - 0.2, CLAY),
    box(w / 2 - 0.08, 0.4, 0.1, 0.16, 0.25, d - 0.2, CLAY),
    ...Array.from({ length: seats }, (_, i) => box((i - (seats - 1) / 2) * seat, 0.4, 0.1, seat - 0.02, 0.14, d - 0.34, LINEN)),
  ]
}

const chair = (): Part[] => [
  ...legs(0.45, 0.45, 0.43, 0.04, 0.02, WALNUT),
  box(0, 0.43, 0, 0.45, 0.04, 0.45, OAK),
  box(0, 0.47, -0.205, 0.45, 0.43, 0.04, OAK),
]

const RECIPES: Record<Exclude<FurnitureKind, 'windowbox' | 'wallpot'>, () => Part[]> = {
  bed2: () => bed(1.6, 2, 2),
  bed1: () => bed(0.9, 2, 1),
  sofa: () => sofa(2, 0.9, 3),
  armchair: () => sofa(0.85, 0.85, 1),
  table: () => [box(0, 0.7, 0, 1.6, 0.05, 0.9, OAK), ...legs(1.6, 0.9, 0.7, 0.07, 0.06, WALNUT)],
  chair,
  desk: () => [
    box(0, 0.71, 0, 1.2, 0.04, 0.6, OAK),
    box(-0.56, 0, 0, 0.04, 0.71, 0.58, WALNUT),
    box(0.4, 0.05, 0, 0.4, 0.66, 0.56, WALNUT),
    box(0.4, 0.5, 0.285, 0.34, 0.14, 0.02, OAK),
    box(0.4, 0.28, 0.285, 0.34, 0.14, 0.02, OAK),
  ],
  wardrobe: () => [
    box(0, 0, 0, 1.16, 0.05, 0.56, WALNUT),
    box(0, 0.05, 0, 1.2, 1.95, 0.6, OAK),
    box(-0.3, 0.1, 0.3, 0.56, 1.85, 0.02, LINEN),
    box(0.3, 0.1, 0.3, 0.56, 1.85, 0.02, LINEN),
    box(-0.04, 1.0, 0.32, 0.02, 0.2, 0.02, WALNUT),
    box(0.04, 1.0, 0.32, 0.02, 0.2, 0.02, WALNUT),
  ],
  shelf: () => [
    box(0, 0, -0.14, 0.8, 1.8, 0.02, WALNUT),
    box(-0.385, 0, 0, 0.03, 1.8, 0.3, OAK),
    box(0.385, 0, 0, 0.03, 1.8, 0.3, OAK),
    ...[0, 0.45, 0.9, 1.35, 1.77].map((y) => box(0, y, 0, 0.8, 0.03, 0.3, OAK)),
    ...BOOKS.map((c, i) => box(-0.3 + i * 0.07, 0.48, 0, 0.05, 0.28 - (i % 2) * 0.04, 0.2, c)),
    ...BOOKS.map((c, i) => box(0.05 + i * 0.07, 0.93, 0, 0.05, 0.3 - (i % 3) * 0.03, 0.2, c)),
  ],
  counter: () => [
    box(0, 0.08, 0, 2.4, 0.78, 0.58, CREAM),
    box(0, 0, -0.01, 2.36, 0.08, 0.5, SLATE),
    box(0, 0.86, 0, 2.4, 0.04, 0.6, STONE),
    ...[-0.9, -0.3, 0.3, 0.9].map((x) => box(x, 0.12, 0.295, 0.56, 0.7, 0.02, LINEN)),
  ],
  rug: () => [{ ...box(0, 0, 0, 2, 0.01, 1.4, RUG), castShadow: false }],
  plant: () => [
    cyl(0, 0, 0, 0.34, 0.3, 0.34, POT),
    cyl(0, 0.3, 0, 0.3, 0.02, 0.3, SOIL),
    cyl(0, 0.3, 0, 0.04, 0.4, 0.04, WALNUT),
    blob(0, 0.5, 0, 0.5, 0.42, 0.5, LEAF),
    blob(0.06, 0.8, 0.04, 0.38, 0.34, 0.38, LEAF_LIGHT),
    blob(-0.08, 0.98, -0.04, 0.26, 0.22, 0.26, LEAF),
  ],
}

/** Small round dots (fruit or blooms) of `size` at `at`, or none when the plant has no colour to show. */
const dots = (at: number[][], size: number, color?: number): Part[] =>
  color === undefined ? [] : at.map(([x, y, z]) => blob(x, y, z, size, size, size, color))

/** A ring of `n` leaves of size w x h x w at radius `r`, bottoms at `y`, alternating two greens. */
const ring = (n: number, r: number, y: number, w: number, h: number, colors: [number, number]): Part[] =>
  Array.from({ length: n }, (_, i) => blob(r * Math.cos((2 * Math.PI * i) / n), y, r * Math.sin((2 * Math.PI * i) / n), w, h, w, colors[i % 2]))

/** A terracotta pot of diameter `w` and height `h` with its soil. */
const terracotta = (w: number, h: number): Part[] => [cyl(0, 0, 0, w, h, w, POT), cyl(0, h, 0, w - 0.04, 0.02, w - 0.04, SOIL)]
/** A square planter of side `w` and height `h` with its soil. */
const planter = (w: number, h: number, color: number): Part[] => [box(0, 0, 0, w, h, w, color), box(0, h, 0, w - 0.04, 0.02, w - 0.04, SOIL)]

/**
 * A pot shaped after the plant's growth form (plants.ts), each within the 0.4 m plant footprint (foliage up to 0.5 m) and
 * 1.2 m: a tall pot for a tree, a low bowl for a succulent, a square planter for sword leaves and leafy crops, terracotta
 * otherwise. `accent` colours the fruit or the blooms, when the plant has them.
 */
const POTTED: Record<PlantForm, (accent?: number) => Part[]> = {
  tree: (accent) => [
    ...terracotta(0.36, 0.4),
    cyl(0, 0.42, 0, 0.05, 0.4, 0.05, WALNUT),
    blob(0, 0.68, 0, 0.5, 0.38, 0.5, LEAF),
    blob(0.06, 0.9, 0.03, 0.32, 0.26, 0.32, LEAF_LIGHT),
    ...dots([[0.2, 0.8, 0.1], [-0.18, 0.86, -0.08], [0.04, 0.74, -0.21], [-0.1, 0.78, 0.19]], 0.07, accent),
  ],
  shrub: (accent) => [
    ...terracotta(0.3, 0.24),
    blob(0, 0.24, 0, 0.44, 0.3, 0.44, LEAF),
    blob(0.08, 0.36, 0.06, 0.26, 0.22, 0.26, LEAF_LIGHT),
    blob(-0.08, 0.38, -0.05, 0.24, 0.22, 0.24, LEAF),
    blob(0, 0.46, -0.02, 0.2, 0.18, 0.2, LEAF_LIGHT),
    ...dots([[0.16, 0.42, 0.06], [-0.12, 0.46, 0.1], [0.04, 0.5, -0.14], [-0.14, 0.38, -0.1], [0.08, 0.56, 0.04]], 0.07, accent),
  ],
  // Broad leaves held flat on stalks of three heights.
  upright: () => [
    ...terracotta(0.32, 0.3),
    cyl(0.04, 0.3, -0.05, 0.03, 0.7, 0.03, LEAF_DEEP),
    cyl(0.03, 0.3, 0.02, 0.03, 0.56, 0.03, LEAF_DEEP),
    cyl(-0.05, 0.3, -0.03, 0.03, 0.42, 0.03, LEAF_DEEP),
    blob(0.03, 0.96, -0.12, 0.18, 0.06, 0.24, LEAF_DARK),
    blob(0.12, 0.82, 0.04, 0.26, 0.06, 0.18, LEAF_DARK),
    blob(-0.13, 0.68, -0.04, 0.24, 0.06, 0.18, LEAF_DEEP),
    blob(-0.04, 0.56, 0.12, 0.2, 0.06, 0.22, LEAF_DARK),
    blob(0.1, 0.48, -0.1, 0.2, 0.05, 0.18, LEAF_DEEP),
  ],
  // A low mound with strands hanging over the rim.
  trailing: (accent) => [
    ...terracotta(0.3, 0.28),
    blob(0, 0.26, 0, 0.36, 0.18, 0.36, LEAF),
    blob(0.17, 0.04, 0, 0.08, 0.3, 0.1, LEAF_LIGHT),
    blob(-0.17, 0.08, 0, 0.08, 0.26, 0.1, LEAF_LIGHT),
    blob(0, 0.06, 0.17, 0.1, 0.28, 0.08, LEAF_LIGHT),
    blob(0, 0.12, -0.17, 0.1, 0.22, 0.08, LEAF_LIGHT),
    blob(0.12, 0.12, 0.12, 0.08, 0.22, 0.08, LEAF),
    ...dots([[0.17, 0.06, 0.04], [-0.04, 0.1, 0.18], [0.08, 0.36, -0.08], [-0.1, 0.34, 0.06]], 0.07, accent),
  ],
  succulent: () => [
    cyl(0, 0, 0, 0.36, 0.12, 0.36, STONE),
    cyl(0, 0.12, 0, 0.32, 0.01, 0.32, SOIL),
    ...ring(6, 0.1, 0.12, 0.11, 0.08, [SUCCULENT, SUCCULENT_LIGHT]),
    blob(0, 0.12, 0, 0.12, 0.18, 0.12, SUCCULENT_LIGHT),
  ],
  // Stiff upright blades, half of them turned a quarter.
  sword: () => [
    ...planter(0.3, 0.32, SLATE),
    ...[[0, 0, 0.74], [0.06, 0.05, 0.6], [-0.07, 0.03, 0.66], [0.04, -0.07, 0.52], [-0.05, -0.05, 0.7], [0.08, -0.01, 0.46]].map(([x, z, h], i) =>
      i % 2 ? box(x, 0.33, z, 0.025, h, 0.06, LEAF_DEEP) : box(x, 0.33, z, 0.06, h, 0.025, SWORD)),
  ],
  // A crown with fronds reaching out and down.
  fern: () => [
    ...terracotta(0.3, 0.28),
    blob(0, 0.28, 0, 0.22, 0.3, 0.22, LEAF),
    blob(0.13, 0.36, 0, 0.22, 0.08, 0.1, LEAF_LIGHT),
    blob(-0.13, 0.38, 0, 0.22, 0.08, 0.1, LEAF_LIGHT),
    blob(0, 0.4, 0.13, 0.1, 0.08, 0.22, LEAF_LIGHT),
    blob(0, 0.34, -0.13, 0.1, 0.08, 0.22, LEAF_LIGHT),
    blob(0.09, 0.48, 0.09, 0.14, 0.08, 0.14, LEAF),
    blob(-0.09, 0.46, -0.09, 0.14, 0.08, 0.14, LEAF),
    blob(0.21, 0.24, 0, 0.08, 0.14, 0.08, LEAF_LIGHT),
    blob(-0.21, 0.26, 0, 0.08, 0.14, 0.08, LEAF_LIGHT),
  ],
  grass: () => [
    ...terracotta(0.3, 0.22),
    ...[[0, 0, 0.42], [0.06, 0.02, 0.34], [-0.05, 0.04, 0.38], [0.02, -0.06, 0.3], [-0.04, -0.05, 0.36], [0.07, -0.04, 0.26], [-0.08, 0, 0.28], [0.03, 0.07, 0.32], [-0.02, 0.08, 0.25]].map(([x, z, h], i) =>
      cyl(x, 0.22, z, 0.025, h, 0.025, i % 2 ? LEAF : LEAF_LIGHT)),
  ],
  // Leaves up a cane.
  climber: (accent) => [
    ...terracotta(0.3, 0.26),
    cyl(0, 0.26, 0, 0.025, 0.86, 0.025, OAK),
    blob(0.06, 0.3, 0.04, 0.26, 0.22, 0.26, LEAF),
    blob(-0.06, 0.48, -0.03, 0.24, 0.2, 0.24, LEAF_LIGHT),
    blob(0.05, 0.66, 0.02, 0.22, 0.2, 0.22, LEAF),
    blob(-0.04, 0.84, 0, 0.18, 0.18, 0.18, LEAF_LIGHT),
    ...dots([[0.13, 0.4, 0.08], [-0.13, 0.58, -0.02], [0.11, 0.76, -0.06], [-0.02, 0.66, 0.13], [0.06, 0.45, -0.13]], 0.07, accent),
  ],
  // A low rosette of leaves, as a lettuce or a chard in a trough.
  leafy: () => [
    ...planter(0.38, 0.18, STONE),
    ...ring(6, 0.11, 0.19, 0.16, 0.1, [LEAF, LEAF_LIGHT]),
    blob(0, 0.19, 0, 0.18, 0.2, 0.18, LEAF_LIGHT),
  ],
  mound: (accent) => [
    ...terracotta(0.28, 0.24),
    blob(0, 0.24, 0, 0.4, 0.24, 0.4, LEAF),
    blob(0, 0.32, 0, 0.28, 0.2, 0.28, LEAF_LIGHT),
    ...dots([[0, 0.48, 0.02], [0.12, 0.42, -0.08], [-0.12, 0.42, 0.08], [0.14, 0.36, 0.1], [-0.1, 0.38, -0.12], [0.04, 0.4, 0.15], [-0.15, 0.34, -0.02]], 0.09, accent),
  ],
  // Low leaves, then a flower on each stem.
  bulb: (accent) => [
    ...terracotta(0.3, 0.22),
    blob(0, 0.22, 0, 0.24, 0.12, 0.24, LEAF),
    ...[[0, 0, 0.42], [0.06, 0.04, 0.34], [-0.06, 0.03, 0.38], [0.03, -0.06, 0.3], [-0.04, -0.05, 0.36]].flatMap(([x, z, h]) => [
      cyl(x, 0.22, z, 0.02, h, 0.02, LEAF_LIGHT),
      ...dots([[x, 0.2 + h, z]], 0.09, accent),
    ]),
  ],
}

/**
 * The look of a pot of `plant`: its form, the colour of its fruit or blooms (flowers and flowering forms get one of the
 * blooms, picked by id; fruit, and the fruiting vegetables on a bush, a cane or a trailing stem, the fruit colour), and the
 * template key the two make.
 */
export function potLook(plant: Plant): { form: PlantForm; accent?: number; key: string } {
  const bloom = [...plant.id].reduce((n, c) => n + c.charCodeAt(0), 0) % BLOOMS.length
  const flowering = plant.kind === 'flower' || plant.form === 'mound' || plant.form === 'bulb'
  const fruiting = plant.kind === 'fruit' || (plant.kind === 'vegetable' && ['shrub', 'climber', 'trailing'].includes(plant.form))
  const accent = flowering ? BLOOMS[bloom] : fruiting ? FRUIT : undefined
  return { form: plant.form, accent, key: `pot-${plant.form}-${accent?.toString(16) ?? 'leaf'}` }
}

/** Parts scaled by `s` about their origin, then moved by (dx, dy, dz). */
const placed = (parts: Part[], s: number, dx: number, dy: number, dz: number): Part[] =>
  parts.map((p) => ({ ...p, at: [p.at[0] * s + dx, p.at[1] * s + dy, p.at[2] * s + dz], size: [p.size[0] * s, p.size[1] * s, p.size[2] * s] }))

/** The plant of a potted look without its pot (every look starts with the pot and its soil), its bottom at 0. */
const foliage = (potted: Part[]): Part[] => placed(potted.slice(2), 1, 0, -potted[0].size[1], 0)

/** A terracotta trough `w` wide on two brackets, with small plants of the look in a row. Front (+z) is away from the facade. */
const windowBox = (w: number, potted: Part[]): Part[] => {
  const n = Math.max(1, Math.min(6, Math.round(w / 0.3)))
  return [
    box(0, 0, 0, w, TROUGH_HEIGHT, 0.2, POT),
    box(0, TROUGH_HEIGHT, 0, w - 0.04, 0.02, 0.16, SOIL),
    ...[-1, 1].map((u) => box(u * (w / 2 - 0.12), -0.12, -0.08, 0.03, 0.14, 0.03, SLATE)),
    ...Array.from({ length: n }, (_, i) => placed(foliage(potted), 0.55, (i - (n - 1) / 2) * (w / n), TROUGH_HEIGHT + 0.02, 0.02)).flat(),
  ]
}

/** A small shelf on a bracket, its back on the wall (-z), with the potted look on it, smaller. */
const wallPot = (potted: Part[]): Part[] => [
  box(0, 0, 0, 0.36, 0.03, 0.24, OAK),
  box(0, -0.16, -0.105, 0.04, 0.16, 0.03, WALNUT),
  ...placed(potted, 0.7, 0, 0.03, 0.02),
]

const templates = new Map<string, Group>()

/** The parts of a piece: a pot (or a window box, a wall planter) shaped after a known species' growth form, else the kind's own recipe. */
function partsOf(f: Furniture): { key: string; parts: Part[] } {
  const plant = f.plant ? plantById(f.plant) : undefined
  const look = plant ? potLook(plant) : { form: 'shrub' as const, accent: undefined, key: 'pot-leaf' }
  if (f.kind === 'windowbox') return { key: `wb-${sizeOf(f).w}-${look.key}`, parts: windowBox(sizeOf(f).w, POTTED[look.form](look.accent)) }
  if (f.kind === 'wallpot') return { key: `wp-${look.key}`, parts: wallPot(POTTED[look.form](look.accent)) }
  if (f.kind !== 'plant' || !plant) return { key: f.kind, parts: RECIPES[f.kind]() }
  return { key: look.key, parts: POTTED[look.form](look.accent) }
}

/** One template per kind (and per look of a potted plant): a group of boxes and cylinders sharing the unit geometries and the colour materials. */
function template(f: Furniture): Group {
  const { key, parts } = partsOf(f)
  let g = templates.get(key)
  if (g) return g
  g = new Group()
  for (const part of parts) {
    const mesh = new Mesh(part.geometry, material(part.color))
    // `at[1]` is the bottom of the part, the unit shapes are centred.
    mesh.scale.set(...part.size)
    mesh.position.set(part.at[0], part.at[1] + part.size[1] / 2, part.at[2])
    mesh.castShadow = part.castShadow ?? true
    mesh.receiveShadow = true
    g.add(mesh)
  }
  templates.set(key, g)
  return g
}

/**
 * A piece standing on a floor at height `floorY` (its own `y` when it is not on the apartment floor): a clone of the kind's template (geometry and materials are shared, so
 * placing a hundred chairs costs a hundred small groups). Plan rotation is clockwise on screen, three.js turns the
 * other way around y.
 */
export function furnitureMesh(f: Furniture, floorY: number): Group {
  const g = template(f).clone()
  g.position.set(f.x, f.y ?? floorY, f.z)
  g.rotation.y = (-f.rot * Math.PI) / 180
  g.userData.furnitureKind = f.kind
  return g
}
