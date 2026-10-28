import { createPlanEditor, loadSavedPlan } from '../src/editor'
import type { Building } from '../src/osm'
import { defaultPlan } from '../src/plan'

const origin = { lat: 45.4642, lon: 9.19 }
const rect = (x: number, z: number, w: number, d: number) => [
  { x, z },
  { x: x + w, z },
  { x: x + w, z: z + d },
  { x, z: z + d },
]
const building = (id: string, outer: { x: number; z: number }[], holes: { x: number; z: number }[][] = []): Building => ({
  id, outer, holes, minHeight: 0, height: 15, heightSource: 'levels', levels: 5, tags: { building: 'yes' },
})

// L-shaped footprint with a courtyard
const main = building(
  'way/dev-1',
  [{ x: -20, z: -12 }, { x: 20, z: -12 }, { x: 20, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 14 }, { x: -20, z: 14 }],
  [[{ x: -14, z: -7 }, { x: -6, z: -7 }, { x: -6, z: 4 }, { x: -14, z: 4 }]],
)
const neighbors = [building('way/dev-2', rect(24, -12, 14, 20)), building('way/dev-3', rect(-20, 20, 30, 10))]

const editor = createPlanEditor(document.getElementById('editor-host')!, (plan) => {
  ;(window as unknown as { lastPlan: unknown }).lastPlan = plan
})
editor.open(main, neighbors, loadSavedPlan(main.id) ?? defaultPlan(main, origin, 1))
editor.setVisible(true)
;(window as unknown as { editor: unknown }).editor = editor
