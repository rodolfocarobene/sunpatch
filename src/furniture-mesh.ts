import { BoxGeometry, CylinderGeometry, Group, IcosahedronGeometry, Mesh, MeshStandardMaterial, type BufferGeometry } from 'three'
import type { Furniture, FurnitureKind } from './furniture'

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

const RECIPES: Record<FurnitureKind, () => Part[]> = {
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

const templates = new Map<FurnitureKind, Group>()

/** One template per kind: a group of boxes and cylinders sharing the unit geometries and the colour materials. */
function template(kind: FurnitureKind): Group {
  let g = templates.get(kind)
  if (g) return g
  g = new Group()
  for (const part of RECIPES[kind]()) {
    const mesh = new Mesh(part.geometry, material(part.color))
    // `at[1]` is the bottom of the part, the unit shapes are centred.
    mesh.scale.set(...part.size)
    mesh.position.set(part.at[0], part.at[1] + part.size[1] / 2, part.at[2])
    mesh.castShadow = part.castShadow ?? true
    mesh.receiveShadow = true
    g.add(mesh)
  }
  templates.set(kind, g)
  return g
}

/**
 * A piece standing on a floor at height `floorY`: a clone of the kind's template (geometry and materials are shared, so
 * placing a hundred chairs costs a hundred small groups). Plan rotation is clockwise on screen, three.js turns the
 * other way around y.
 */
export function furnitureMesh(f: Furniture, floorY: number): Group {
  const g = template(f.kind).clone()
  g.position.set(f.x, floorY, f.z)
  g.rotation.y = (-f.rot * Math.PI) / 180
  g.userData.furnitureKind = f.kind
  return g
}
