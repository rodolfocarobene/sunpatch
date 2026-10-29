// Dev page: a 12 x 10 m, 4 x 3 m test building with an apartment on floor 1 (3 windows south, 1 east).
// /dev/apartment.html?date=2026-12-21&time=13:00&cutaway=1&half=1 (half: apartment covers only the west part),
// &edits=1 (balcony slab over the south windows on the floor above, plus a notch cut from the NE corner),
// &windows=edge (windows at the corners, overlapping, and too tall), &fix=1 (apply the editor's window clamping first),
// &walk=1 (stand inside, looking at the windows; &at=x,z picks the spot).
import { createScene } from '../src/scene'
import type { Building, Point } from '../src/osm'
import type { Plan } from '../src/plan'
import * as geom from '../src/editor-geom'
import { sunDirection } from '../src/sun'

const params = new URLSearchParams(location.search)
const date = params.get('date') ?? '2026-12-21'
const time = params.get('time') ?? '13:00'
const cutaway = params.get('cutaway') !== '0'
const half = params.get('half') === '1'
const walk = params.get('walk') === '1'
const edits = params.get('edits') === '1'
const origin = { lat: 45.4642, lon: 9.19 }

const rect = (x0: number, z0: number, x1: number, z1: number): Point[] => [
  { x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 },
]
const box = (id: string, x0: number, z0: number, x1: number, z1: number, height: number): Building => ({
  id,
  outer: [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }],
  holes: [],
  minHeight: 0,
  height,
  heightSource: 'tag',
  levels: Math.round(height / 3),
  tags: {},
})

const house = box('test/house', -6, -5, 6, 5, 12)
const buildings = [
  house,
  box('test/south', -10, 25, 8, 31, 9),
  box('test/west', -30, -8, -16, 6, 15),
]

const east = half ? 2 : 6
const outer: Point[] = [{ x: -6, z: -5 }, { x: east, z: -5 }, { x: east, z: 5 }, { x: -6, z: 5 }]
const plan: Plan = {
  version: 1,
  buildingId: house.id,
  origin,
  floor: 1,
  floorHeight: 3,
  outline: { outer, holes: [] },
  walls: [{ a: { x: -1, z: -5 }, b: { x: -1, z: 1 }, thickness: 0.1 }],
  windows: [
    ...[0.2, 0.5, 0.8].map((t) => ({ ring: 0, edge: 2, t, width: 1.2, sill: 0.9, height: 1.4 })),
    { ring: 0, edge: 1, t: 0.5, width: 1.2, sill: 0.9, height: 1.4 },
  ],
  ...(edits && {
    edits: [
      { kind: 'add', outline: rect(-2, 5, 4, 6.5), bottom: 6, top: 6.3 },
      { kind: 'cut', outline: rect(2, -5, 6, -1), bottom: 6, top: 9 },
    ],
  }),
}

if (params.get('windows') === 'edge') {
  const w = { width: 1.2, sill: 0.9, height: 1.4 }
  plan.windows = [
    { ring: 0, edge: 2, t: 0.02, ...w },
    { ring: 0, edge: 2, t: 0.45, ...w },
    { ring: 0, edge: 2, t: 0.5, ...w },
    { ring: 0, edge: 2, t: 0.98, ...w },
    { ring: 0, edge: 1, t: 0.5, width: 1.2, sill: 2.3, height: 1.4 },
  ]
}
if (params.get('fix') === '1') geom.normalizeWindows(plan)

const sunScene = createScene(document.querySelector<HTMLElement>('#app')!)
sunScene.setBuildings(buildings, house.id)
sunScene.setPlan(plan)
sunScene.setCutaway(cutaway)
const offset = Number(date.slice(5, 7)) >= 4 && Number(date.slice(5, 7)) <= 10 ? '+02:00' : '+01:00'
const [atX, atZ] = (params.get('at') ?? '').split(',').map(Number)
if (walk) sunScene.startWalk(Number.isFinite(atX) && Number.isFinite(atZ) ? { x: atX, z: atZ } : undefined)
sunScene.update(sunDirection(new Date(`${date}T${time}:00${offset}`), origin.lat, origin.lon))
;(window as unknown as { __ready: boolean }).__ready = true
