import './style.css'
import { createMapView } from './map'
import { createStatusChip } from './chip'
import { createPlanEditor, loadSavedPlan, savePlan } from './editor'
import { EXAMPLE_WHEN, loadExample } from './example'
import {
  distanceToRing,
  hiddenOutlines,
  parseOverpass,
  project,
  ringCentroid,
  unproject,
  type Building,
  type Origin,
  type OverpassElement,
  type Point,
} from './osm'
import { carrySelection, restoreSelection, selectBuilding, togglePart } from './block'
import { fetchBuildingElements, RADIUS_M } from './overpass'
import { nextStep } from './next-step'
import { defaultPlan, floorBase, rebasePlan, type Plan } from './plan'
import { createScene } from './scene'
import { tileBuildings } from './tiles'
import { parseGreen, scatterTrees } from './trees'
import { dayLabel, minutesOfDay } from './daylight'
import { createSunMapJob } from './sunmap-job'
import { createSunMapPopover } from './sunmap-popover'
import { sampleAt, sampleMinutes, spotStats, type SunMapResult } from './sunmap'
import { createUI, sunSentence, type View } from './ui'
import { createWalkHud } from './walk'

const MILAN = { lat: 45.4642, lon: 9.19 }
const dateKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`

const app = document.querySelector<HTMLDivElement>('#app')!
const sunScene = createScene(app)
const ui = createUI((sun) => sunScene.update(sun), setView, (on) => sunScene.setCutaway(on), walkInside)
const hud = createWalkHud(app, {
  exit: () => sunScene.stopWalk(),
  setMinutes: (minutes) => ui.setMinutes(minutes),
  togglePlay: () => ui.togglePlay(),
  toggleCutaway: () => ui.toggleCutaway(),
})
ui.onCutaway((hidden) => hud.setCutaway(hidden))
ui.onPlaying((playing) => hud.setPlaying(playing))
// Sun map: computed in a worker for the shown date, painted on the floor, and read by clicking the floor.
const sunJob = createSunMapJob()
const popover = createSunMapPopover(app, closeProbe)
let sunMapOn = false
let sunResult: SunMapResult | undefined
/** Where the user clicked, kept so the popover can be redone when the result changes. */
let probePoint: Point | undefined
/** The date, strip and place the sun was last computed for; the sun map follows them. */
let sunDay: { when: Date; strip: string; lat: number; lon: number } | undefined
let sunKey = ''
let sunTimer: number | undefined

/** Asks for the sun map after the current synchronous changes (a pick sets buildings, then the plan) are done. */
function scheduleSunMap() {
  window.clearTimeout(sunTimer)
  sunTimer = window.setTimeout(requestSunMap, 0)
}

function requestSunMap() {
  if (!sunMapOn || !site || !plan || !sunDay) return
  const { selected } = site
  const { when, lat, lon } = sunDay
  sunJob.request({
    sceneVersion: sunScene.sceneVersion(),
    plan,
    floorY: floorBase(selected, plan),
    day: when,
    lat,
    lon,
    occluders: () => sunScene.occluders(),
  })
}

function closeProbe() {
  probePoint = undefined
  popover.hide()
  sunScene.setProbe(null)
}

function showProbe() {
  if (!sunResult || !probePoint || !sunDay) return
  const sample = sampleAt(sunResult.grid, probePoint.x, probePoint.z)
  if (sample === undefined) return closeProbe()
  popover.show(spotStats(sunResult, sample), sunDay.strip, minutesOfDay(sunDay.when))
}

sunJob.onState((state) => {
  if (!sunMapOn) return
  if (state.status === 'computing') {
    // An old map would show the wrong day while the new one runs.
    sunResult = undefined
    sunScene.setSunMap(null)
    if (popover.open) closeProbe()
    ui.setSunMapStatus({ kind: 'computing', progress: state.progress })
  } else if (state.status === 'ready') {
    sunResult = state.result
    sunScene.setSunMap({ grid: state.result.grid, minutes: sampleMinutes(state.result) })
    ui.setSunMapStatus({ kind: 'ready', daylightMinutes: state.result.daylightMinutes, day: sunDay?.when ?? new Date() })
    showProbe()
  } else if (state.status === 'error') ui.setSunMapStatus({ kind: 'error', message: state.message })
})
ui.onSunMap((on) => {
  sunMapOn = on
  sunScene.setSunMapVisible(on)
  if (on) scheduleSunMap()
  else {
    sunJob.stop()
    sunResult = undefined
    sunScene.setSunMap(null)
    closeProbe()
  }
})
sunScene.onSceneChange(() => {
  sunKey = ''
  sunResult = undefined
  closeProbe()
  if (sunMapOn) scheduleSunMap()
})
sunScene.onFloorClick((at) => {
  if (!at) return closeProbe()
  probePoint = at
  sunScene.setProbe(at)
  showProbe()
  if (!popover.open) closeProbe()
})
sunScene.onProbeScreen((at) => popover.moveTo(at))
if (import.meta.env.DEV) {
  Object.assign(window, {
    __sunpatch: { scene: sunScene, result: () => sunResult, floorY: () => (site && plan ? floorBase(site.selected, plan) : 0) },
  })
}

sunScene.setWalkHandlers({
  change(walking) {
    hud.show(walking)
    ui.setWalking(walking)
    if (walking) closeProbe()
  },
  exit: () => sunScene.stopWalk(),
  stepTime: (minutes) => ui.stepTime(minutes),
  togglePlay: () => ui.togglePlay(),
  toggleCutaway: () => ui.toggleCutaway(),
  look: (yaw) => hud.setYaw(yaw),
})
ui.onChange((when, sun, strip, place) => {
  hud.setSun(sun)
  hud.setStatus(`${dayLabel(when.getMonth(), when.getDate())} \u00b7 ${sunSentence(sun, 'up')}`)
  hud.setTime(minutesOfDay(when), strip)
  sunDay = { when, strip, ...place }
  popover.setNow(minutesOfDay(when))
  // Only another day or place needs a new sun map; the time slider just moves along it.
  const key = `${dateKey(when)} ${place.lat} ${place.lon}`
  if (key !== sunKey) {
    sunKey = key
    if (sunMapOn) scheduleSunMap()
  }
})
const mapView = createMapView(document.body, MILAN, pick, ui.searchSlot)
// ?example=milan: a bundled sample apartment; its edits are never saved, so a stored plan of the same building stays safe.
let exampleMode = new URLSearchParams(location.search).get('example') === 'milan'
const editor = createPlanEditor(document.body, setPlan, { autosave: () => !exampleMode, onSwitch: (id, at) => switchTo(id, at) })
sunScene.onPartClick(togglePartAt)
sunScene.onBuildingClick((id, at) => switchTo(id, at))
const chip = createStatusChip(app, () => last && void refine(last, current))

// Starts on the map: there is nothing to show in 3D until a building is picked.
let view: View = 'map'
setView('map')
if (exampleMode) void openExample()
else mapView.focusSearch() // the search is the first thing to do on the map

async function openExample() {
  const { buildings, selected, origin, plan: examplePlan, green, elements, near } = await loadExample()
  loaded = { elements, center: near }
  show(buildings, selected, origin, false)
  sunScene.setTrees(scatterTrees(green, buildings))
  setPlan(examplePlan, true)
  ui.setWhen(EXAMPLE_WHEN.date, EXAMPLE_WHEN.minutes)
  ui.setExample(true)
  setView('3d')
}

function walkInside() {
  setView('3d')
  sunScene.startWalk()
}

function setView(next: View) {
  if (next === 'plan' && !openEditor()) return
  view = next
  app.hidden = next !== '3d'
  mapView.setVisible(next === 'map')
  editor.setVisible(next === 'plan')
  sunScene.setActive(next === '3d')
  if (next === '3d') sunScene.resize()
  ui.setView(next)
}

interface Pick {
  clicked: { lat: number; lon: number }
  /** Scene origin of the tile preview, if one was shown; kept so the camera does not jump. */
  origin?: { lat: number; lon: number }
}

let current = 0
let pending: AbortController | undefined
let last: Pick | undefined
/** The user added or removed parts of the selection (shift-click) since the last pick. */
let edited = false
/** The Overpass answer behind the scene, and where it is centred: the data to switch buildings from without a request. */
let loaded: { elements: OverpassElement[]; center: { lat: number; lon: number } } | undefined
/** Chip text to show instead of the usual one when the current load ends (set when switching buildings). */
let note: string | undefined
const SWITCHED = 'Switched building. Your previous plan is saved.'

function pick(lat: number, lon: number) {
  exampleMode = false // from here on it is the user's own building: plans load and save as usual
  ui.setExample(false)
  edited = false
  loaded = undefined
  note = undefined
  pending?.abort()
  chip.hide()
  const token = ++current
  const clicked = { lat, lon }
  // Instant preview from the vector tiles already on the map.
  const features = mapView.getTileBuildings()
  const hit = selectBuilding(tileBuildings(features, clicked, RADIUS_M), project(lat, lon, clicked))
  last = { clicked }
  if (hit) {
    const origin = unproject(ringCentroid(hit.outer), clicked)
    const buildings = tileBuildings(features, origin, RADIUS_M)
    const selected = choose(buildings, origin, clicked)!
    last.origin = origin
    sunScene.setTrees([]) // the old trees belong to the old origin
    show(buildings, selected, origin, false)
    mapView.setLoading(false)
  } else {
    mapView.setLoading(true)
  }
  void refine(last, token)
}

/** The building being worked on, with the scene data the plan editor needs. */
let site: { buildings: Building[]; selected: Building; origin: Origin } | undefined
let plan: Plan | undefined

function show(buildings: Building[], selected: Building, origin: Origin, keepCamera: boolean) {
  // The OSM refinement replaces the tile preview of the same building: carry its plan over.
  const carried = plan && site && plan.buildingId === site.selected.id && keepCamera
  site = { buildings, selected, origin }
  sunScene.setBuildings(buildings, selected, { keepCamera })
  if (carried) setPlan({ ...rebasePlan(plan!, origin), buildingId: selected.id, selection: selected.sources })
  else {
    const saved = exampleMode ? null : savedPlanFor(selected)
    setPlan(saved ? rebasePlan(withoutKey(saved), origin) : undefined)
  }
  ui.setLocation(origin.lat, origin.lon)
  ui.setBuildingInfo(selected)
  ui.setBuildingPicked(true)
  if (view === 'plan') openEditor()
  else setView('3d')
}

const NEIGHBOR_RADIUS_M = 60

/** The building at the click: the flood fill, or the parts a saved plan recorded (older plans have none). */
function choose(buildings: Building[], origin: Origin, clicked: { lat: number; lon: number }): Building | undefined {
  const at = project(clicked.lat, clicked.lon, origin)
  const flooded = selectBuilding(buildings, at)
  const saved = flooded && !exampleMode ? savedPlanFor(flooded) : null
  if (!flooded || !saved?.selection) return flooded
  return restoreSelection(buildings, at, { id: saved.originalId, ids: saved.selection }) ?? flooded
}

/**
 * Click on another building in 3D, or on a neighbour in the Plan: switch to it without going back to the map.
 * Inside the loaded data that is instant and needs no request; beyond it, it is a map pick at that spot (tile
 * preview, then Overpass). The plan being left is saved first, and the new building's own plan, if any, opens.
 */
function switchTo(polygonId: string, at: Point) {
  if (!site) return
  // Plans autosave on every edit; this also covers one carried over from the tile preview.
  if (plan && !exampleMode) savePlan(plan)
  const ll = unproject(at, site.origin)
  const data = loaded
  const [dx, dz] = data ? [project(ll.lat, ll.lon, data.center).x, project(ll.lat, ll.lon, data.center).z] : [Infinity, 0]
  if (!data || Math.hypot(dx, dz) > RADIUS_M) {
    pick(ll.lat, ll.lon)
    note = SWITCHED
    return
  }
  const flooded = selectBuilding(site.buildings, at)
  if (!flooded || (site.selected.sources ?? [site.selected.id]).includes(polygonId) || !site.buildings.some((b) => b.id === polygonId)) return
  exampleMode = false
  ui.setExample(false)
  edited = false
  pending?.abort()
  chip.hide()
  current++
  const origin = unproject(ringCentroid(flooded.outer), site.origin)
  const buildings = parseOverpass(data.elements, origin).buildings
  const selected = choose(buildings, origin, ll)
  if (!selected) return
  last = { clicked: ll, origin }
  show(buildings, selected, origin, false)
  sunScene.setTrees(scatterTrees(parseGreen(data.elements, origin), buildings))
  chip.done(SWITCHED)
  if (view === 'plan') editor.notify(SWITCHED) // the chip lives in the 3D view
}

/** Shift-click in 3D: add the polygon to the selection or take it out; the plan carries over and is saved. */
function togglePartAt(polygonId: string) {
  if (!site) return
  const result = togglePart(site.buildings, site.selected, polygonId)
  if ('hint' in result) {
    chip.done(result.hint)
    return
  }
  edited = true
  show(site.buildings, result.selected, site.origin, true)
  if (plan && !exampleMode) savePlan(plan)
}

/** A plan saved on the building, or on any polygon that is now merged into it (older plans used the clicked one). */
function savedPlanFor(b: Building): (Plan & { originalId: string }) | null {
  for (const id of [b.id, ...(b.sources ?? [])]) {
    const saved = loadSavedPlan(id)
    if (saved) return { ...saved, buildingId: b.id, originalId: id }
  }
  return null
}

const withoutKey = ({ originalId: _, ...plan }: Plan & { originalId: string }): Plan => plan

/** Opens the editor on the selected building; false when there is none yet. */
function openEditor(): boolean {
  if (!site) return false
  const { buildings, selected, origin } = site
  const hidden = hiddenOutlines(buildings)
  const own = new Set(selected.sources ?? [selected.id])
  const c = ringCentroid(selected.outer)
  const neighbors = buildings.filter(
    (b) => !own.has(b.id) && !hidden.has(b.id) && distanceToRing(b.outer, c) < NEIGHBOR_RADIUS_M,
  )
  if (!plan) setPlan(defaultPlan(selected, origin))
  editor.open(selected, neighbors, plan!)
  return true
}

/** close: frame the apartment itself rather than the whole building. */
function setPlan(next: Plan | undefined, close = false) {
  plan = next
  sunScene.setPlan(next ?? null, { close })
  ui.setPlanActive(next !== undefined)
  ui.setNextStep(nextStep(next, site?.selected))
}

/** Replaces the preview with the detailed Overpass buildings; ignored if a newer pick started. */
async function refine({ clicked, origin }: Pick, token: number) {
  const hasPreview = origin !== undefined
  pending = new AbortController()
  if (hasPreview) chip.loading()
  try {
    const elements = await fetchBuildingElements(clicked.lat, clicked.lon, { signal: pending.signal })
    if (token !== current) return
    let sceneOrigin = origin
    if (!sceneOrigin) {
      // No preview: centre on the building found, as the preview would have.
      const first = selectBuilding(parseOverpass(elements, clicked).buildings, project(clicked.lat, clicked.lon, clicked))
      if (first) sceneOrigin = unproject(ringCentroid(first.outer), clicked)
    }
    if (!sceneOrigin) {
      mapView.setStatus('No building here, click on a building', 'error')
      return
    }
    const { buildings } = parseOverpass(elements, sceneOrigin)
    // Parts the user trimmed or added on the preview carry over to the OSM polygons that cover them.
    const at = project(clicked.lat, clicked.lon, sceneOrigin)
    const selected = hasPreview && edited && site ? carrySelection(buildings, site.selected, at) : choose(buildings, sceneOrigin, clicked)
    if (!selected) {
      // Nothing in OSM under the click: the preview stays.
      if (hasPreview) chip.done('Detailed OSM data loaded (no OSM building at this point)')
      else mapView.setStatus('No building here, click on a building', 'error')
      return
    }
    loaded = { elements, center: clicked }
    show(buildings, selected, sceneOrigin, hasPreview)
    sunScene.setTrees(scatterTrees(parseGreen(elements, sceneOrigin), buildings))
    if (hasPreview) chip.done(note ?? 'Detailed OSM data loaded')
    else mapView.setStatus('Click on a building to pick it.')
  } catch (err) {
    if (token !== current) return
    if (hasPreview) chip.failed('Showing map-tile buildings (OpenStreetMap server unavailable)')
    else mapView.setStatus((err as Error).message, 'error')
  } finally {
    if (token === current) mapView.setLoading(false)
  }
}
