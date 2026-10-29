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
import { minutesOfDay } from './daylight'
import { createPanelCard, formatKwh, type CardState, type EnergyView } from './panel-card'
import { createPanelTotals } from './panel-totals'
import { EXCLUDED_INSIDE, panelInside, referenceEnergy, referenceLine, totalsLine, verdict } from './panel-verdict'
import { DEFAULT_ASSUMPTIONS, panelEnergy, type Assumptions } from './solar'
import { DAYS_IN_MONTH, type PanelShade } from './panel-shade'
import { climateKey, loadClimate, type Climate } from './weather'
import { modules, newPanelId } from './panel'
import { createPanelShadeJob, shadeKey as panelShadeKey } from './panel-shade-job'
import { createSunMapJob } from './sunmap-job'
import { createSuitabilityJob, type SuitabilityResult } from './suitability-job'
import { createSuitabilityPopover } from './suitability-popover'
import { IRRADIATION_STRIDE, panelFor, rampScale, surfaceEnergy, surfaceSamples, suitabilityColor, suitabilityText, type SurfaceEnergy } from './suitability'
import { createSunMapPopover } from './sunmap-popover'
import { sampleAt, sampleMinutes, spotStats, type SunMapResult } from './sunmap'
import { createUI, type View } from './ui'
import { escapeAction, probeOutcome } from './probe'
import { createWalkHud } from './walk'

const MILAN = { lat: 45.4642, lon: 9.19 }
const dateKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`

const app = document.querySelector<HTMLDivElement>('#app')!
const sunScene = createScene(app)
const ui = createUI((sun) => sunScene.update(sun), setView, (on) => sunScene.setCutaway(on), walkInside)
const hud = createWalkHud(app, ui.dock, { exit: () => sunScene.stopWalk() })
// Sun map: computed in a worker for the shown date, painted on the floor, and read by clicking the floor.
const sunJob = createSunMapJob()
const popover = createSunMapPopover(app, closeProbe)
let sunMapOn = false
let sunResult: SunMapResult | undefined
/** Where the user clicked, kept so the popover can be redone when the result changes. */
let plan: Plan | undefined // declared early: the sun callback below can fire before the building is picked
let probePoint: Point | undefined
/** The date, strip and place the sun was last computed for; the sun map follows them. */
let sunDay: { when: Date; strip: string; lat: number; lon: number } | undefined
let sunKey = ''
let sunTimer: number | undefined

// Panel suitability: where on the facade, roof and ground a panel would make the most energy per kWp. Computed in a
// worker when the switch goes on, painted as coloured quads, read by clicking one (and a panel placed from there).
const suitJob = createSuitabilityJob()
const suitPopover = createSuitabilityPopover(app, { onClose: closeSuitPick, onPlace: placeHere })
let suitOn = false
let suitResult: SuitabilityResult | undefined
let suitEnergy: SurfaceEnergy[] = []
let suitPicked: number | null = null
/** True while a panel placed from the map rebuilds the scene: the old map stays up until the new one is ready. */
let suitKeep = false
let suitTimer: number | undefined

// Panel shading: the selected panel (in the Plan editor, in the Panels list or clicked in the Panels view) is analysed in a
// worker. The card in the Panels view shows it; the Plan view shows only a one-sentence summary under the panel's properties.
const shadeJob = createPanelShadeJob()
const card = createPanelCard({ onClose: () => selectPanel(null), onAssumptions: setAssumptions, onRetry: retryClimate })
ui.cardSlot.appendChild(card.el)
const planSummary = document.createElement('div')
planSummary.className = 'editor-cluster planSummary'
planSummary.hidden = true
planSummary.innerHTML = '<p></p><button type="button">Open in Panels</button>'
const planSummaryText = planSummary.querySelector('p')!
planSummary.querySelector('button')!.addEventListener('click', () => setView('panels'))
let selectedPanel: string | null = null
/** Key of the request last sent, so repeated asks for the same scene and panel do not restart the card. */
let shadeAsked = ''

function showCards(state: CardState) {
  card.set(state)
  planSummaryText.textContent =
    state.status === 'ready' ? state.energy.verdict.sentence
    : state.status === 'error' ? state.message
    : 'Working out the sun on this panel\u2026'
  // The same warning treatment and alert role as the Panels card's verdict.
  const warning = state.status === 'ready' && state.energy.verdict.warning
  planSummaryText.classList.toggle('warn', warning)
  if (warning) planSummaryText.setAttribute('role', 'alert')
  else planSummaryText.removeAttribute('role')
  planSummary.hidden = view !== 'plan' || state.status === 'idle' || selectedPanel === null
}

// Energy: the shading analysis gives clear-sky irradiation, NASA POWER (one request per place, once a panel exists)
// gives the monthly weather factor, and the assumptions turn both into kWh.
let assumptions: Assumptions = { ...DEFAULT_ASSUMPTIONS }
let climate: Climate | undefined
let climateAt = ''
let climateStatus: 'idle' | 'loading' | 'error' = 'idle'
let lastShade: { shade: PanelShade; panel: Plan['panels'][number] } | undefined
const totals = createPanelTotals(renderTotals)
const panelArea = (p: Plan['panels'][number]): number => p.width * p.height * modules(p)

function ensureClimate() {
  if (!sunDay || !plan || (plan.panels.length === 0 && !suitOn)) return
  const place = climateKey(sunDay.lat, sunDay.lon)
  if (climateAt === place.key && climateStatus !== 'idle') return
  climateAt = place.key
  climate = undefined
  climateStatus = 'loading'
  loadClimate(place.lat, place.lon).then(
    (c) => {
      if (climateAt !== place.key) return
      climate = c
      climateStatus = 'idle'
      renderEnergy()
      paintSuitability()
    },
    () => {
      if (climateAt !== place.key) return
      climateStatus = 'error'
      renderEnergy()
      paintSuitability()
    },
  )
  renderEnergy()
}

function retryClimate() {
  climateAt = ''
  climateStatus = 'idle'
  ensureClimate()
}

function setAssumptions(next: Assumptions) {
  assumptions = next
  renderEnergy()
  paintSuitability()
}

/** What the card shows for a panel: the figures, the sentence and the yardstick. */
function energyView(panel: Plan['panels'][number], shade: PanelShade, area: number): EnergyView {
  const energy = panelEnergy(shade.irradiation, area, assumptions, DAYS_IN_MONTH, climate?.clearness)
  const weather = climate ? 'ready' : climateStatus === 'error' ? 'error' : 'loading'
  const inside = site ? panelInside(panel, site.selected) : false
  const reference = sunDay
    ? referenceLine(referenceEnergy(panel, sunDay.lat, sunDay.lon, sunDay.when.getFullYear(), assumptions, climate?.clearness), climate !== undefined, sunDay.lat)
    : null
  return { energy, weather, assumptions, area, verdict: verdict({ energy, weather, shadingLoss: shade.shadingLoss, inside }), reference }
}

function renderEnergy() {
  if (lastShade && selectedPanel === lastShade.panel.id) {
    const { shade, panel } = lastShade
    const area = panelArea(panel)
    showCards({
      status: 'ready',
      shade,
      energy: energyView(panel, shade, area),
    })
  }
  renderTotals()
}

/** The Panels list: a row per panel with its yearly energy once analysed, and every panel's energy added up. */
function renderTotals() {
  const panels = plan?.panels ?? []
  const shades = totals.shades()
  const energies = new Map<string, { ideal: number; weather?: number }>()
  for (const p of panels) {
    const shade = shades.get(p.id)
    if (shade) energies.set(p.id, panelEnergy(shade.irradiation, panelArea(p), assumptions, DAYS_IN_MONTH, climate?.clearness))
  }
  const figure = (e: { ideal: number; weather?: number }) => (climate && e.weather !== undefined ? e.weather : e.ideal)
  const indoor = new Set(panels.filter((p) => site && panelInside(p, site.selected)).map((p) => p.id))
  const items = panels.map((p, i) => {
    const e = energies.get(p.id)
    const detail = indoor.has(p.id) ? EXCLUDED_INSIDE : e ? `${formatKwh(figure(e))} a year` : 'Analysing\u2026'
    return { id: p.id, label: `Panel ${i + 1}`, detail }
  })
  let total: string | null = null
  if (panels.length > 0 && !totals.busy() && energies.size === panels.length) {
    total = totalsLine(panels.map((p) => ({ kwh: figure(energies.get(p.id)!), inside: indoor.has(p.id) })), climate !== undefined)
  }
  ui.setPanelList({ items, selected: selectedPanel, total })
}

function requestTotals() {
  if (!sunDay || !plan) return
  totals.update(
    { sceneVersion: sunScene.sceneVersion(), lat: sunDay.lat, lon: sunDay.lon, year: sunDay.when.getFullYear(), occluders: () => sunScene.occluders() },
    plan.panels,
  )
  ensureClimate()
}

function selectPanel(id: string | null) {
  if (id === selectedPanel) return
  selectedPanel = id
  shadeAsked = ''
  renderTotals()
  if (id) requestShade()
  else {
    shadeJob.stop()
    showCards({ status: 'idle' })
  }
}

function requestShade() {
  requestTotals()
  if (!selectedPanel || !sunDay) return
  const panel = plan?.panels.find((p) => p.id === selectedPanel)
  if (!panel) return selectPanel(null)
  const req = {
    sceneVersion: sunScene.sceneVersion(),
    panel: { ...panel },
    lat: sunDay.lat,
    lon: sunDay.lon,
    year: sunDay.when.getFullYear(),
    occluders: () => sunScene.occluders(),
  }
  const key = panelShadeKey(req)
  if (key === shadeAsked) return
  shadeAsked = key
  shadeJob.request(req)
}

shadeJob.onState((state) => {
  if (state.status === 'ready') {
    const panel = plan?.panels.find((p) => p.id === selectedPanel)
    if (!panel) return
    lastShade = { shade: state.shade, panel: { ...panel } }
    renderEnergy()
  }
  else if (state.status === 'computing') {
    lastShade = undefined
    showCards({ status: 'computing' })
  }
  else if (state.status === 'error') showCards({ status: 'error', message: state.message })
})

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

/** Asks for the suitability map after the current synchronous changes (a pick sets buildings, then the plan) are done. */
function scheduleSuitability() {
  window.clearTimeout(suitTimer)
  suitTimer = window.setTimeout(requestSuitability, 0)
}

function requestSuitability() {
  if (!suitOn || !site || !plan || !sunDay) return
  const { selected, buildings } = site
  const { lat, lon, when } = sunDay
  ensureClimate()
  suitJob.request({
    sceneVersion: sunScene.sceneVersion(),
    lat,
    lon,
    year: when.getFullYear(),
    samples: () => surfaceSamples(selected, buildings, lat),
    occluders: () => sunScene.occluders(),
  })
}

/** The figure of every spot (local weather once the climate is known) and the quads coloured by it; waits for the climate. */
function paintSuitability() {
  if (!suitOn || !suitResult) return
  if (climateStatus === 'loading') return ui.setSuitabilityStatus({ kind: 'computing', progress: 1 })
  const { samples, irradiation } = suitResult
  suitEnergy = samples.map((_, i) => surfaceEnergy(irradiation, i * IRRADIATION_STRIDE, assumptions, climate?.clearness))
  const figures = suitEnergy.map((e) => e.weather ?? e.ideal)
  const { min, max, ticks, observed } = rampScale(figures)
  const colors = new Float32Array(samples.length * 3)
  figures.forEach((v, i) => colors.set(suitabilityColor(v, min, max), i * 3))
  sunScene.setSuitability({ samples, colors })
  ui.setSuitabilityStatus({ kind: 'ready', min, max, ticks, observed, weather: climate !== undefined, count: samples.length })
  if (suitPicked !== null) showSuitPick()
}

function showSuitPick() {
  if (!suitResult || suitPicked === null || !suitEnergy[suitPicked]) return closeSuitPick()
  sunScene.setSuitabilityMark(suitPicked)
  suitPopover.show(suitabilityText(suitResult.samples[suitPicked], suitEnergy[suitPicked]))
}

function closeSuitPick() {
  suitPicked = null
  suitPopover.hide()
  sunScene.setSuitabilityMark(null)
}

/** "Place a panel here": the preset of the surface at the chosen spot, added to the plan and selected. */
function placeHere() {
  if (!suitResult || suitPicked === null || !plan) return
  const panel = panelFor(suitResult.samples[suitPicked], newPanelId())
  closeSuitPick()
  suitKeep = true
  setPlan({ ...plan, panels: [...plan.panels, panel] })
  suitKeep = false
  if (!exampleMode) savePlan(plan!)
  selectPanel(panel.id)
}

suitJob.onState((state) => {
  if (!suitOn) return
  if (state.status === 'computing') {
    ui.setSuitabilityStatus({ kind: 'computing', progress: state.progress, updating: suitResult !== undefined })
  } else if (state.status === 'ready') {
    suitResult = state.result
    paintSuitability()
  } else if (state.status === 'error') ui.setSuitabilityStatus({ kind: 'error', message: state.message })
})
ui.onSuitability((on) => {
  suitOn = on
  sunScene.setSuitabilityVisible(on)
  if (on) {
    if (sunMapOn) ui.setSunMap(false) // both paint on the same surfaces; one at a time
    scheduleSuitability()
  } else {
    suitJob.stop()
    suitResult = undefined
    closeSuitPick()
    sunScene.setSuitability(null)
  }
})
sunScene.onBuildingInView((inView) => ui.setSuitabilityFrame(!inView))
ui.onSuitabilityFrame(() => sunScene.frameSelected())
sunScene.onSuitabilityClick((index) => {
  suitPicked = index
  if (index === null) closeSuitPick()
  else showSuitPick()
})
sunScene.onSuitabilityScreen((at) => suitPopover.moveTo(at))

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
  if (on && suitOn) ui.setSuitability(false)
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
  requestShade()
  sunKey = ''
  sunResult = undefined
  closeProbe()
  if (sunMapOn) scheduleSunMap()
  if (suitOn) {
    // The map belongs to the scene it was traced in: a new building or plan clears it (a panel placed from it keeps it until the update arrives).
    closeSuitPick()
    if (!suitKeep) {
      suitResult = undefined
      sunScene.setSuitability(null)
    }
    scheduleSuitability()
  }
})
sunScene.onFloorClick((at) => {
  if (!at) return closeProbe()
  probePoint = at
  sunScene.setProbe(at)
  // Walking, a click is a question about the sun map: it turns the map on, and the answer comes when it is ready.
  if (!sunMapOn) ui.setSunMap(true)
  const inGrid = sunResult !== undefined && sampleAt(sunResult.grid, at.x, at.z) !== undefined
  const outcome = probeOutcome(sunResult !== undefined, inGrid)
  if (outcome === 'show') showProbe()
  else if (outcome === 'close') closeProbe()
})
let walking = false
/** Esc: a first press closes an open popover, and while walking the next one leaves walk mode. */
function escape() {
  const action = escapeAction({ walking, popoverOpen: popover.open })
  if (action === 'close-popover') closeProbe()
  else if (action === 'exit-walk') sunScene.stopWalk()
}
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || walking) return
  if (suitPopover.open) return closeSuitPick()
  if (view === 'panels' && selectedPanel && !popover.open) selectPanel(null)
  else escape() // walking, the walk controls report Esc themselves
})
sunScene.onProbeScreen((at) => popover.moveTo(at))
if (import.meta.env.DEV) {
  Object.assign(window, {
    __sunpatch: { scene: sunScene, selectPanel, shadeJob, suit: () => suitResult, suitFigures: () => suitEnergy.map((e) => e.weather ?? e.ideal), plan: () => plan, result: () => sunResult, floorY: () => (site && plan ? floorBase(site.selected, plan) : 0) },
  })
}

sunScene.setWalkHandlers({
  change(isWalking) {
    walking = isWalking
    if (isWalking) ui.setSuitability(false) // the map belongs to the outside view
    hud.show(isWalking)
    ui.setWalking(isWalking)
    closeProbe() // a spot marked in one view is not where the camera is in the other
  },
  exit: escape,
  stepTime: (minutes) => ui.stepTime(minutes),
  togglePlay: () => ui.togglePlay(),
  toggleCutaway: () => ui.toggleCutaway(),
  toggleSunMap: () => ui.toggleSunMap(),
  look: (yaw) => hud.setYaw(yaw),
})
ui.onChange((when, sun, strip, place) => {
  hud.setSun(sun)
  sunDay = { when, strip, ...place }
  popover.setNow(minutesOfDay(when))
  // Only another day or place needs a new sun map; the time slider just moves along it.
  const key = `${dateKey(when)} ${place.lat} ${place.lon}`
  if (key !== sunKey) {
    sunKey = key
    if (sunMapOn) scheduleSunMap()
    requestShade()
  }
})
const mapView = createMapView(document.body, MILAN, pick, ui.searchSlot)
// ?example=milan: a bundled sample apartment; its edits are never saved, so a stored plan of the same building stays safe.
let exampleMode = new URLSearchParams(location.search).get('example') === 'milan'
const editor = createPlanEditor(document.body, setPlan, {
  autosave: () => !exampleMode,
  onSwitch: (id, at) => switchTo(id, at),
  panelSummary: planSummary,
  onPanelSelect: selectPanel,
})
sunScene.onPanelClick((id) => {
  if (view === 'panels') selectPanel(id) // in 3D a panel is just part of the scene
})
ui.onPanelPick(selectPanel)
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

/** The Panels view needs a plan to hold the panels: the whole floor, as when the editor opens first. */
function ensurePlan(): boolean {
  if (!site) return false
  if (!plan) setPlan(defaultPlan(site.selected, site.origin))
  return true
}

function setView(next: View) {
  if (next === 'plan' && !openEditor()) return
  if (next === 'panels' && !ensurePlan()) return
  view = next
  const scene3d = next === '3d' || next === 'panels' // one scene and one camera for both
  app.hidden = !scene3d
  mapView.setVisible(next === 'map')
  editor.setVisible(next === 'plan')
  sunScene.setActive(scene3d)
  if (scene3d) sunScene.resize()
  if (next !== 'panels') ui.setSuitability(false) // the map belongs to the Panels view
  ui.setView(next)
  renderTotals()
  planSummary.hidden = next !== 'plan' || selectedPanel === null
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
  else if (view !== 'panels') setView('3d') // the Panels view stays put when another building is picked in 3D
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
  editor.open(selected, neighbors, plan!, selectedPanel)
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
