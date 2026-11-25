import './style.css'
import { createMapView } from './map'
import { createStatusChip, type ChipAction } from './chip'
import { buildingClickAction, createUndoSlot, NEIGHBOUR_NOTE } from './switch-undo'
import { buildingLine } from './building-line'
import { createPlanEditor, loadSavedPlan, savePlan, stripSavedHeights } from './editor'
import { EXAMPLE_RADIUS_M, EXAMPLE_WHEN, loadExample } from './example'
import {
  distanceToRing,
  buildingContains,
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
import { fetchBuildingData, REUSE_M } from './overpass'
import { countBuildings, covers, neighborhoodLine, neighborhoodRadius, withinRadius, type NeighborhoodId } from './neighborhood'
import { nextStep } from './next-step'
import { selectionGeoJSON } from './map-selection'
import { defaultFloorHeight, defaultPlan, floorBase, levelCount, rebasePlan, type Plan } from './plan'
import { createHeightStore, resolveHeights } from './height-store'
import { createKeepChip } from './keep-chip'
import { showHeightsNote } from './heights-note'
import { applyHeights, keepKnown, reselect, type HeightOverride, type HeightOverrides } from './heights'
import { createHeightPopover, createHoverTip } from './height-popover'
import { createHeightRuler, cycleOrder, hoverNoteKind, nextInCycle } from './height-ruler'
import { hoverLines } from './building-line'
import { onLofiChange } from './lofi-ui'
import { createScene, type FrameTarget, type SurfacePoint } from './scene'
import { tileBuildings } from './tiles'
import { parseGreen, scatterTrees, TREE_RADIUS_M } from './trees'
import { dateValue, minutesOfDay } from './daylight'
import { createPanelCard, formatKwh, type CardState, type EnergyView } from './panel-card'
import { createPanelTotals } from './panel-totals'
import { EXCLUDED_INSIDE, panelInside, referenceEnergy, referenceLine, totalsLine, verdict } from './panel-verdict'
import { DEFAULT_ASSUMPTIONS, panelEnergy, type Assumptions } from './solar'
import { DAYS_IN_MONTH, type PanelShade } from './panel-shade'
import { climateKey, loadClimate, type Climate } from './weather'
import { modules, newPanelId } from './panel'
import { createPanelShadeJob, shadeKey as panelShadeKey } from './panel-shade-job'
import { createSunMapJob } from './sunmap-job'
import { createYearJob } from './year-job'
import { createYearCard } from './year-card'
import { dayHeadline } from './headline'
import { YEAR_DAY } from './year'
import { createSuitabilityJob, type SuitabilityResult } from './suitability-job'
import { createSuitabilityPopover } from './suitability-popover'
import { createGardenJob, GARDEN_AREA_SLOT_MINUTES, type GardenResult, type GardenState } from './garden-job'
import { discSpots, gardenSpots, meanDaylight, meanSun, roofSpots } from './garden-spots'
import { insideOutline } from './walk-geom'
import { bestSpot, findDeadEnd, roofNoteVisible, spotPlace, findSummary, monthCounts, kindsFor, kindStats, stepOf, surfaceY, type Scored } from './garden-find'
import { createFindPanel } from './garden-find-panel'
import type { DeadEnd } from './garden-text'
import { scoreSpots, type PlantResult } from './garden'
import { furnitureName, hasPot, newFurniture, potAt, snapMetres, specOf, type Furniture } from './furniture'
import { plantById, plantName, type Plant } from './plants'
import { classifyHit, CUT_HINT, FACADE_HINT, GROUND_TOP, type PickedKind } from './garden-pick'
import { bestOfKind, getKindFilter } from './garden-kind'
import { createGardenCard, type GardenCardInput } from './garden-card'
import { createPlantCard } from './plant-card'
import { plantRow } from './garden-text'
import { IRRADIATION_STRIDE, panelFor, rampScale, surfaceEnergy, surfaceSamples, suitabilityColor, suitabilityText, type SurfaceEnergy } from './suitability'
import { createSunMapPopover } from './sunmap-popover'
import { CELL, sampleAt, sampleMinutes, spotStats, type SunMapResult } from './sunmap'
import { createUI, type View } from './ui'
import { escapeAction, probeOutcome } from './probe'
import { createWalkHud } from './walk'
import { fmt1Fixed, fmtMonth, onBeforeLangSwitch, t, upFirst, type Key } from './i18n'
import { facadeWalls } from './apartment'
import { bandOf, daylightColor, summarize } from './dayfactor'
import { glassTriangles } from './dayfactor-trace'
import { createDaylightJob, type DaylightResult } from './dayfactor-job'
import { createSurfaceJob } from './surface-job'
import { bandWord } from './ui'
import { touchOnly } from './touch'
import { cameraAfterWalk, cameraForKey, pickCamera, shownCamera, type CameraMode } from './camera-mode'
import { createContextMenu, type MenuEntry } from './context-menu'
import { MENU_FURNITURE, MENU_PLANTS, MOUNT_PLANTS, sceneMenuItems, type SceneMenuItem } from './scene-menu'
import { mountSpot, outerSillAt, wallPotAt, windowBoxAt } from './wall-mount'
import { saveSession, takeSession } from './session'
import { decodeShare, encodeShare, shareUrl } from './share'
import { createSharedChip } from './shared-chip'
import { validatePlan } from './editor-geom'

const MILAN = { lat: 45.4642, lon: 9.19 }
const dateKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`

const app = document.querySelector<HTMLDivElement>('#app')!
const sunScene = createScene(app)
onLofiChange((on) => sunScene.setLofiPixelRatio(on))
const ui = createUI((sun) => sunScene.update(sun), setView, (on) => sunScene.setCutaway(on))
const hud = createWalkHud(app, ui.dock, { exit: () => sunScene.stopWalk(), hold: (move, on) => sunScene.holdWalk(move, on) })
// Sun map: computed in a worker for the shown date, painted on the floor, and read by clicking the floor.
const sunJob = createSunMapJob()
const popover = createSunMapPopover(app, closeProbe)
const daylightJob = createDaylightJob()
// "Sun here" and "Indirect light here" on a wall, a sill or a reveal: that one point, in a worker of its own.
const surfaceJob = createSurfaceJob()
// "Through the year" under the headline: worked out (in a worker of its own) only while its disclosure is open.
const yearJob = createYearJob()
const yearCard = createYearCard(document.getElementById('yearSlot')!)
// Building heights: the hover note says where a height came from, the right-click box (or the building line's button) changes it.
const hoverTip = createHoverTip(document.body)
const heightRuler = createHeightRuler(document.body, {
  resolve(id, near) {
    const building = site?.buildings.find((b) => b.id === id)
    const anchor = building && sunScene.rulerAnchor(building, near)
    return building && anchor ? { building, anchor } : null
  },
  onPreview: (id, height) => sunScene.previewHeight(id, height),
  onCommit: (id, override) => setHeight(id, override),
  // The keyboard side of the ruler: the note beside the handle follows the height it shows.
  onNote(id, height) {
    const building = site?.buildings.find((b) => b.id === id)
    const handle = document.querySelector('#heightRuler .hrHandle')
    if (height === null || !building || !handle) return hoverTip.hide()
    const r = handle.getBoundingClientRect()
    hoverTip.show(hoverLines(building, 'keys', height), { x: r.right + 24, y: r.top })
  },
  returnFocus: () => sceneCanvas.focus({ preventScroll: true }),
  cycle: () => cycleRuler(),
})
// The 3D canvas takes focus, so the keyboard reaches the ruler: R steps it through the buildings (selected first, then the nearest).
const sceneCanvas = app.querySelector('canvas')!
sceneCanvas.tabIndex = 0
sceneCanvas.setAttribute('aria-label', t('shell.canvasAria'))
function cycleRuler() {
  if (view !== '3d' || walking || heightPopover.isOpen || !site) return
  const order = cycleOrder(site.buildings, site.selected.id)
  const rect = sceneCanvas.getBoundingClientRect()
  const centre = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  let id = nextInCycle(order, heightRuler.currentId)
  for (let tries = 0; id !== undefined && tries < order.length; tries++) {
    const building = site.buildings.find((b) => b.id === id)
    if (building && heightRuler.open(building, centre)) return
    id = nextInCycle(order, id)
  }
}
sceneCanvas.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyR' || e.ctrlKey || e.metaKey || e.altKey) return
  e.preventDefault()
  cycleRuler()
})
const heightPopover = createHeightPopover(document.body, { onApply: setHeight, onReset: (id) => setHeight(id, null) })
const sceneMenu = createContextMenu(document.body)
let sunMapOn = false
let daylightOn = false
let daylightResult: DaylightResult | undefined
let sunResult: SunMapResult | undefined
const HEADLINE_CELL = 0.5
/** Sample spacing of the request behind `sunResult`; the painted map needs the fine grid. */
let tracedCell = CELL
/** Where the user clicked, kept so the popover can be redone when the result changes. */
let plan: Plan | undefined // declared early: the sun callback below can fire before the building is picked
let probePoint: Point | undefined
/** A wall, sill or reveal point asked about instead (`room` is the floor beside it), and which light: the floor layers stay as they are. */
let surfaceProbe: { at: SurfacePoint; room: Point; daylight: boolean; shown?: 'working' | 'answer' } | undefined
/** The date, strip and place the sun was last computed for; the sun map follows them. */
let sunDay: { when: Date; strip: string; lat: number; lon: number } | undefined
let sunKey = ''
let sunTimer: number | undefined

// Garden: a click on the floor, the ground or a roof traces that one point over the year in a worker and the card says
// what grows there. Outdoor spots also need the local temperatures (NASA POWER, cached by weather.ts).
const gardenJob = createGardenJob()
/** With a plant picked the plant map answers first, so the spot card folds to its header until the user opens it or picks another spot. */
let gardenCardOpen = true
const setGardenMonth = (m: number | null) => {
  gardenMonth = m
  gardenHint = undefined
  if (findPlant) gardenCardOpen = false
  renderGarden()
}
const findJob = createGardenJob() // the plant map's whole-area trace; the clicked spot has the job above, so neither stops the other
const findPanel = createFindPanel({
  onPlant: (id) => setFindPlant(id ? plantById(id) : undefined),
  onMonth: setGardenMonth,
  onBest: () => showBestSpot(),
  onClear: () => clearFind(),
  onRetryClimate: () => retryGardenClimate(),
  onRetryTrace: () => requestFind(true),
})
ui.gardenFindSlot.appendChild(findPanel.el)
ui.gardenMonthSlot.appendChild(findPanel.monthEl)
const gardenCard = createGardenCard({
  onRetryClimate: () => retryGardenClimate(),
  onRetryTrace: () => requestGarden(true),
  onClose: () => clearGardenSpot(),
  onMonth: setGardenMonth,
  onToggle: () => {
    gardenCardOpen = !gardenCardOpen
    renderGarden()
  },
  onPlant: (id) => {
    plantCardAuto = false
    plantCardId = id
    renderPlantCard()
  },
  onRanked: (ranked) => {
    spotRanked = ranked
    if (plantCardAuto && ranked) plantCardId = bestOfKind(ranked, getKindFilter())?.plant.id
    renderPlantCard()
  },
})
ui.gardenSlot.appendChild(gardenCard.el)

// The plant card: the picked plant (finder) or the best plant of the clicked spot, with a spot row click switching it. Floats on
// the right; on a phone it sits at the top of the sheet's Garden slot instead.
let plantCardId: string | undefined
/** The card follows the spot's top-ranked plant until the user picks one. */
let plantCardAuto = false
let spotRanked: PlantResult[] | null = null
const plantCard = createPlantCard({ onClose: () => closePlantCard(), onPot: putPotHere })
const narrow = window.matchMedia('(max-width: 700px)')
const placePlantCard = () => (narrow.matches ? ui.gardenSlot.prepend(plantCard.el) : document.body.appendChild(plantCard.el))
placePlantCard()
narrow.addEventListener('change', placePlantCard)
function renderPlantCard() {
  const plant = plantCardId ? plantById(plantCardId) : undefined
  const result = plant && gardenSpot ? spotRanked?.find((r) => r.plant.id === plant.id) : undefined
  const piece = plant && gardenSpot && plan ? spotPot(plant.id, gardenSpot) : undefined
  const pot = piece && plan ? { placed: hasPot(plan.furniture, piece), kind: piece.kind === 'windowbox' || piece.kind === 'wallpot' ? piece.kind : ('pot' as const) } : undefined
  plantCard.set(plant ? { plant, here: result ? plantRow(result, gardenMonth) : undefined, pot } : null)
}

/** "Put a pot here": a pot of the card's plant at the picked spot, as furniture (so it is saved, shared and drawn in Plan). */
function putPotHere() {
  const plant = plantCardId ? plantById(plantCardId) : undefined
  if (!plant || !gardenSpot || !plan) return
  const pot = spotPot(plant.id, gardenSpot)
  if (hasPot(plan.furniture, pot)) return
  // Undo takes this pot away again, whatever else was edited since.
  editFurniture((list) => [...list, pot], (list) => list.filter((f) => !hasPot([f], pot)), t('plant.potChip'))
}
/**
 * A furniture change made in the scene ("Put a pot here", the context menu): saved with the plan like an editor edit, and
 * the chip's Undo applies `undo` to the list as it is then.
 */
function editFurniture(change: (list: Furniture[]) => Furniture[], undo: (list: Furniture[]) => Furniture[], done: string) {
  if (!plan) return
  const apply = (next: Plan) => {
    keepingSpot(() => setPlan(next, true))
    if (!ephemeral()) savePlan(next) // the built-in example is never saved: the change lives until the page is reloaded
    renderPlantCard()
  }
  apply({ ...plan, furniture: change(plan.furniture ?? []) })
  chip.done(done, { label: t('shell.undo'), run: () => plan && apply({ ...plan, furniture: undo(plan.furniture ?? []) }) })
}
function closePlantCard() {
  plantCardId = undefined
  plantCardAuto = false
  renderPlantCard()
}
let gardenSpot: { kind: PickedKind; x: number; y: number; z: number; neighbourRoof: boolean } | undefined
/** The picked spot is in front of a window or a wall: "Put a pot here" hangs this (a window box, a wall planter) instead. */
let spotMount: ((plant: string) => Furniture | undefined) | undefined
/** What "Put a pot here" puts at the picked spot: a pot, or what hangs there. */
const spotPot = (plant: string, spot: { kind: PickedKind; x: number; y: number; z: number }): Furniture =>
  spotMount?.(plant) ?? potAt(plant, spot, spot.kind === 'indoor')
/** A scene change that leaves the picked spot where it is (furniture counted or not, a pot placed): the spot is traced again in the new scene. */
let keepSpot = false
function keepingSpot(change: () => void) {
  keepSpot = true
  try {
    change()
  } finally {
    keepSpot = false
  }
  if (!gardenSpot) return
  const { x, y, z } = gardenSpot
  sunScene.setGardenMark({ x, y, z })
  requestGarden()
}
let gardenTrace: GardenCardInput['trace'] = { status: 'idle' }
let gardenMonth: number | null = null
let gardenHint: string | undefined
let gardenClimate: { key: string; status: GardenCardInput['weather']; climate?: Climate } = { key: '', status: 'idle' }

function renderGarden() {
  ui.gardenSection.classList.toggle('hasSpot', gardenSpot !== undefined)
  gardenCard.set({
    kind: gardenSpot?.kind ?? null,
    neighbourRoof: gardenSpot?.neighbourRoof,
    place: gardenSpot && site ? spotPlace(gardenSpot.kind, gardenSpot, gardenSpot.kind === 'indoor' && plan ? ringCentroid(plan.outline.outer) : ringCentroid(site.selected.outer), gardenSpot.neighbourRoof) : undefined,
    hint: gardenHint,
    trace: gardenTrace,
    weather: gardenClimate.status,
    climate: gardenClimate.climate,
    month: gardenMonth,
    collapsed: findPlant ? !gardenCardOpen : null,
  })
  renderFind()
  renderRoofHint()
}

/** The roof cannot be picked while the floors above are hidden: say so, but only when the building has a roof to pick. */
let roofChecked = { id: '', has: false }
let floorsHidden = true
let siteDeclared = false // `site` is declared further down; the first renders run before that
function renderRoofHint() {
  if (!siteDeclared) return
  if (site && roofChecked.id !== site.selected.id) roofChecked = { id: site.selected.id, has: roofSpots(site.selected, sunDay?.lat ?? 45).length > 0 }
  ui.setRoofHint(floorsHidden && !!site && roofChecked.has)
}
function retryGardenClimate() {
  gardenClimate = { key: '', status: 'idle' }
  ensureGardenClimate()
}

// The plant map: one plant scored over every spot (indoor floor, ground, roof) and painted in the scene. The sun of the
// spots is traced once per scene (cached by the job); changing plant or month only scores again.
let findPlant: Plant | undefined
let findTrace: GardenCardInput['trace'] = { status: 'idle' }
let findResult: GardenResult | undefined
let findResultId = 0
let findScored: (Scored | undefined)[] = []
let findPainted = ''

function setFindPlant(plant: Plant | undefined) {
  findPlant = plant
  gardenHint = undefined // a note about the last click is not about this
  findPainted = ''
  gardenCardOpen = plant === undefined
  plantCardAuto = !plant && gardenSpot !== undefined
  plantCardId = plant ? plant.id : plantCardAuto && spotRanked ? bestOfKind(spotRanked, getKindFilter())?.plant.id : undefined
  if (!plant) {
    findJob.stop()
    findResult = undefined
    findTrace = { status: 'idle' }
    sunScene.setGardenMap(null)
  } else {
    ensureGardenClimate()
    if (!findResult) requestFind()
  }
  renderGarden()
}

function clearFind() {
  if (!findPlant && !findResult) return
  setFindPlant(undefined)
}

function requestFind(again = false) {
  if (!findPlant || !site || !plan || !sunDay) return
  const { selected, buildings } = site
  const thePlan = plan
  const { lat, lon, when } = sunDay
  if (again) findTrace = { status: 'running', progress: 0 }
  findJob.request({
    sceneVersion: sunScene.sceneVersion(),
    plan: thePlan,
    lat,
    lon,
    year: when.getFullYear(),
    slotMinutes: GARDEN_AREA_SLOT_MINUTES,
    spots: () => gardenSpots(selected, buildings, thePlan, lat),
    occluders: () => sunScene.occluders(),
    glass: () => glassTriangles(facadeWalls(thePlan, selected).glass),
  })
  renderGarden()
}

findJob.onState((state: GardenState) => {
  if (!findPlant) return
  if (state.status === 'running') findTrace = { status: 'running', progress: state.progress }
  else if (state.status === 'done') {
    findTrace = { status: 'done', sunMinutes: [] }
    findResult = state.result
    findResultId++
    console.debug(`garden map: ${state.result.spots.length} spots`)
  } else if (state.status === 'error') findTrace = { status: 'error', message: state.message }
  renderGarden()
})

/** Scores the plant over the spots it can stand on (outdoor ones need the climate) and repaints when something changed. */
function renderFind() {
  const plant = findPlant
  const done = plant && findResult && findTrace.status === 'done'
  const climate = gardenClimate.status === 'ready' ? gardenClimate.climate : undefined
  let summary = ''
  let roofHidden = false
  let deadEnd: DeadEnd | undefined
  let stats: ReturnType<typeof kindStats> = []
  if (plant && findResult && done) {
    const { spots } = findResult
    const key = `${plant.id}|${gardenMonth}|${findResultId}|${climate ? 'c' : 'n'}`
    if (key !== findPainted) {
      findPainted = key
      const { kinds } = kindsFor(plant)
      findScored = Array(spots.length).fill(undefined)
      const month = gardenMonth ?? undefined
      const indoorClimate = { tMean: [], tMin: [], tMax: [], tLow: [] } // indoor spots ignore the weather
      const idx = (indoor: boolean) => spots.map((s, i) => (s.indoor === indoor && kinds.includes(s.kind as never) ? i : -1)).filter((i) => i >= 0)
      for (const [indoor, c] of [[true, indoorClimate], [false, climate]] as const) {
        if (!c) continue
        const ids = idx(indoor)
        scoreSpots(plant, ids.map((i) => spots[i]), c, month).forEach((r, n) => (findScored[ids[n]] = r))
      }
      sunScene.setGardenMap({
        spots: spots.map((s) => ({ x: s.x, y: s.y, z: s.z, kind: s.kind as 'indoor' | 'ground' | 'roof', cell: s.cell })),
        steps: findScored.map((r) => (r ? stepOf(r.rating) : 0)),
      })
    }
    const waiting = !climate && gardenClimate.status !== 'error' && kindsFor(plant).kinds.some((k) => k !== 'indoor') // outdoor spots are not rated yet
    // The roof is not drawn while the floors above are hidden, so it is not counted or named either.
    stats = waiting ? [] : kindStats(spots, shownScores())
    if (!waiting && stats.length > 0 && stats.every((s) => s.good === 0 && s.ok === 0)) {
      const scoredSpots = shownScores().flatMap((r, i) => (r ? [spots[i]] : []))
      deadEnd = findDeadEnd(plant, gardenMonth, monthCounts(plant, scoredSpots, climate ?? { tMean: [], tMin: [], tMax: [], tLow: [] }), scoredSpots, stats.find((s) => s.why)?.why)
    }
    roofHidden = roofNoteVisible(plant, spots, floorsHidden)
    const centre = site ? ringCentroid(site.selected.outer) : { x: 0, z: 0 }
    if (!waiting) summary = findSummary(plantName(plant), gardenMonth === null ? null : fmtMonth(gardenMonth), stats, centre, !!plant.daylight)
  }
  findPanel.set({
    plantId: plant?.id ?? null,
    month: gardenMonth,
    trace: findTrace,
    weather: gardenClimate.status,
    needsClimate: plant?.outdoor ?? false,
    summary,
    deadEnd,
    note: plant ? kindsFor(plant).note : undefined,
    stats,
    roofHidden,
    canShowBest: done === true && findResult !== undefined && bestSpot(findResult.spots, shownScores(), gardenMonth) !== undefined,
  })
}

/** The plant map's scores without the roof spots while the floors above are hidden. */
const shownScores = (): (Scored | undefined)[] =>
  findScored.map((r, i) => (floorsHidden && findResult?.spots[i]?.kind === 'roof' ? undefined : r))

function showBestSpot() {
  if (!findResult) return
  const i = bestSpot(findResult.spots, shownScores(), gardenMonth)
  if (i === undefined) return
  const s = findResult.spots[i]
  selectGardenSpot(s.kind as PickedKind, s.x, surfaceY(s), s.z, false)
}

renderGarden() // the hint, until a spot is picked

function clearGardenSpot() {
  gardenSpot = undefined
  spotMount = undefined
  spotRanked = null
  if (plantCardAuto) closePlantCard()
  gardenHint = undefined
  gardenTrace = { status: 'idle' }
  gardenJob.stop()
  sunScene.setGardenMark(null)
  renderGarden()
}

function ensureGardenClimate() {
  const needed = (gardenSpot !== undefined && gardenSpot.kind !== 'indoor') || findPlant?.outdoor === true
  if (!needed || !sunDay) return
  const place = climateKey(sunDay.lat, sunDay.lon)
  if (gardenClimate.key === place.key && gardenClimate.status !== 'idle') return
  gardenClimate = { key: place.key, status: 'loading' }
  loadClimate(place.lat, place.lon).then(
    (c) => {
      if (gardenClimate.key !== place.key) return
      gardenClimate = { key: place.key, status: 'ready', climate: c }
      renderGarden()
    },
    () => {
      if (gardenClimate.key !== place.key) return
      gardenClimate = { key: place.key, status: 'error' }
      renderGarden()
    },
  )
}

/** Traces the picked spot over the year; `again` forgets a failed run. */
function requestGarden(again = false) {
  if (!gardenSpot || !site || !plan || !sunDay) return
  const { x, y, z, kind } = gardenSpot
  const thePlan = plan
  const { selected } = site
  if (again) gardenTrace = { status: 'running', progress: 0 }
  gardenJob.request({
    sceneVersion: sunScene.sceneVersion(),
    plan,
    lat: sunDay.lat,
    lon: sunDay.lon,
    year: sunDay.when.getFullYear(),
    tag: `${kind} ${x.toFixed(2)} ${y.toFixed(2)} ${z.toFixed(2)}`,
    spots: () => discSpots(x, y, z, kind === 'indoor', kind === 'indoor' ? (px, pz) => insideOutline(thePlan, { x: px, z: pz }) : undefined),
    occluders: () => sunScene.occluders(),
    glass: () => glassTriangles(facadeWalls(thePlan, selected).glass),
  })
  renderGarden()
}

gardenJob.onState((state: GardenState) => {
  if (!gardenSpot) return
  gardenTrace =
    state.status === 'running' ? { status: 'running', progress: state.progress }
    : state.status === 'done' ? { status: 'done', sunMinutes: meanSun(state.result.spots), daylight: meanDaylight(state.result.spots) }
    : state.status === 'error' ? { status: 'error', message: state.message }
    : { status: 'idle' }
  renderGarden()
})
sunScene.onGardenClick((hit) => {
  if (!hit) return // the sky: the spot stays
  const kind = classifyHit(hit)
  if (!kind || kind === 'cut') {
    gardenHint = kind === 'cut' ? CUT_HINT : FACADE_HINT // either way the previous spot stays
    renderGarden()
    return
  }
  // A pot on the sill outside a window would sit in the wall: the spot is in front of the window, and the pot a window box.
  const base = plan && site ? floorBase(site.selected, plan) : 0
  const sill = plan ? outerSillAt(plan, base, hit) : undefined
  if (sill !== undefined) return mountHere(windowBoxAt(plan!, base, sill, ''), (id) => plan && windowBoxAt(plan, base, sill, id))
  selectGardenSpot(kind, hit.x, hit.y, hit.z)
})

/** A spot of the Garden view becomes the picked one (by a click, or "Show the best spot"): its card traces and rates the plants. */
function selectGardenSpot(kind: PickedKind, x: number, y: number, z: number, openCard = true) {
  gardenHint = undefined
  spotMount = undefined
  if (openCard) gardenCardOpen = true
  // A roof outside the picked building's footprints belongs to a neighbour.
  const own = site ? (site.selected.members ?? [site.selected]).some((m) => buildingContains(m, { x, z })) : true
  gardenSpot = { kind, x, y, z, neighbourRoof: kind === 'roof' && !own }
  spotRanked = null
  plantCardAuto = findPlant === undefined
  plantCardId = findPlant?.id
  gardenTrace = { status: 'running', progress: 0 }
  sunScene.setGardenMark({ x, y, z })
  sunScene.revealPoint({ x, y, z })
  ensureGardenClimate()
  requestGarden()
}

// Panel suitability: where on the facade, roof and ground a panel would make the most energy per kWp. Computed in a
// worker when the switch goes on, painted as coloured quads, read by clicking one (and a panel placed from there).
const suitJob = createSuitabilityJob()
const suitPopover = createSuitabilityPopover(app, { onClose: closeSuitPick, onPlace: placeHere })
let suitOn = false
/** The user has the suitability map on: it stays on for the session, off only while another tab is open. */
let suitWish = false
let suitLeaving = false
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
planSummary.innerHTML = '<p></p><button type="button"></button>'
const planSummaryText = planSummary.querySelector('p')!
planSummary.querySelector('button')!.textContent = t('editor.openInPanels')
planSummary.querySelector('button')!.addEventListener('click', () => setView('panels'))
let selectedPanel: string | null = null
/** Key of the request last sent, so repeated asks for the same scene and panel do not restart the card. */
let shadeAsked = ''

function showCards(state: CardState) {
  card.set(state)
  planSummaryText.textContent =
    state.status === 'ready' ? state.energy.verdict.sentence
    : state.status === 'error' ? state.message
    : t('panels.working')
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
    // A figure from before the last change stays up, marked, until the new one is in.
    const stale = e !== undefined && !indoor.has(p.id) && !totals.fresh(p.id)
    const figureText = e ? t('panels.perYear', { kwh: formatKwh(figure(e)) }) : t('panels.analysing')
    const detail = indoor.has(p.id) ? EXCLUDED_INSIDE : stale ? t('panels.staleFigure', { figure: figureText }) : figureText
    return { id: p.id, label: t('panels.rowLabel', { n: i + 1 }), detail, stale }
  })
  let total: string | null = null
  // One panel's total is its own row and card verdict again: the sum is only said when there is something to add up.
  if (panels.length > 1 && energies.size === panels.length) {
    total = totalsLine(panels.map((p) => ({ kwh: figure(energies.get(p.id)!), inside: indoor.has(p.id) })), climate !== undefined)
    if (totals.busy()) total = t('panels.staleFigure', { figure: total })
  }
  ui.setPanelList({ items, selected: selectedPanel, total, totalStale: totals.busy() })
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

/** The year chart's trace: only while the disclosure is open in the 3D tab with an apartment that has windows. */
function requestYear() {
  const usable = view === '3d' && site && plan && sunDay && plan.windows.length > 0
  yearCard.setAvailable(!!usable)
  if (!usable || !yearCard.open) return yearJob.stop()
  yearJob.request({
    sceneVersion: sunScene.sceneVersion(),
    plan: plan!,
    floorY: floorBase(site!.selected, plan!),
    year: sunDay!.when.getFullYear(),
    lat: sunDay!.lat,
    lon: sunDay!.lon,
    occluders: () => sunScene.occluders(),
  })
}
yearJob.onState((state) => {
  if (state.status === 'running') yearCard.setState({ kind: 'running', progress: state.progress })
  else if (state.status === 'ready') yearCard.setState({ kind: 'ready', minutes: state.minutes })
  else if (state.status === 'error') yearCard.setState({ kind: 'error' })
  else yearCard.setState({ kind: 'idle' })
})
yearCard.onToggle(requestYear)
yearCard.onPick((month) => {
  if (sunDay) ui.setWhen(dateValue(new Date(sunDay.when.getFullYear(), month, YEAR_DAY)), minutesOfDay(sunDay.when))
})

function requestSunMap() {
  requestYear()
  // The 3D tab's headline needs the day's lit flags too, so the job runs there with or without the painted map.
  if (!(sunMapOn || view === '3d') || !site || !plan || !sunDay) return
  if (plan.windows.length === 0) {
    sunJob.stop()
    return ui.setHeadline({ kind: 'noWindows' })
  }
  const { selected } = site
  const { when, lat, lon } = sunDay
  // Without the painted map only "is any spot lit" is asked, which a coarser grid answers in a fraction of the time.
  tracedCell = sunMapOn ? CELL : HEADLINE_CELL
  sunJob.request({
    sceneVersion: sunScene.sceneVersion(),
    plan,
    floorY: floorBase(selected, plan),
    day: when,
    lat,
    lon,
    cell: tracedCell,
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
  const { min, max, ticks, observed, clamped } = rampScale(figures)
  const colors = new Float32Array(samples.length * 3)
  figures.forEach((v, i) => colors.set(suitabilityColor(v, min, max), i * 3))
  sunScene.setSuitability({ samples, colors })
  ui.setSuitabilityStatus({ kind: 'ready', min, max, ticks, observed, clamped, weather: climate !== undefined, count: samples.length })
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
  if (!ephemeral()) savePlan(plan!)
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
  if (!suitLeaving) suitWish = on
  sunScene.setSuitabilityVisible(on)
  if (on) {
    if (sunMapOn) ui.setSunMap(false) // both paint on the same surfaces; one at a time
    if (daylightOn) ui.setDaylight(false)
    scheduleSuitability()
  } else {
    suitJob.stop()
    suitResult = undefined
    closeSuitPick()
    sunScene.setSuitability(null)
  }
})
ui.onReframe(() => {
  if (!sunScene.frameView(frameTargetFor(view))) ui.flashReframed()
})
// A side panel leaves the canvas its right part; the narrow bottom sheet takes none of the width.
const narrowScreen = window.matchMedia('(max-width: 700px)')
sunScene.setFrameInset(() => (narrowScreen.matches ? 0 : document.getElementById('panel')?.getBoundingClientRect().right ?? 0))
sunScene.onSuitabilityClick((index) => {
  suitPicked = index
  if (index === null) closeSuitPick()
  else showSuitPick()
})
sunScene.onSuitabilityScreen((at) => suitPopover.moveTo(at))
// A click on the building in Panels while the map is off would do nothing: point at the button instead.
let panelDown: { x: number; y: number; panel: string | null } | undefined
sceneCanvas.addEventListener('pointerdown', (e) => (panelDown = { x: e.clientX, y: e.clientY, panel: selectedPanel }))
sceneCanvas.addEventListener('click', (e) => {
  if (view !== 'panels' || suitOn || !panelDown) return
  const still = Math.hypot(e.clientX - panelDown.x, e.clientY - panelDown.y) < 5 // a drag is an orbit
  if (still && panelDown.panel === selectedPanel) chip.done(t('shell.suitFirst'))
})

function closeProbe() {
  probePoint = undefined
  dropSurfaceProbe()
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
  if (state.status === 'computing') {
    // An old map would show the wrong day while the new one runs.
    sunResult = undefined
    ui.setHeadline({ kind: 'working' })
    if (sunMapOn) {
      sunScene.setSunMap(null)
      if (popover.open && !surfaceProbe) closeProbe()
      ui.setSunMapStatus({ kind: 'computing', progress: state.progress })
    }
  } else if (state.status === 'ready') {
    sunResult = state.result
    ui.setHeadline({ kind: 'ready', day: sunDay?.when ?? new Date(), headline: dayHeadline(state.result) })
    if (!sunMapOn) return
    sunScene.setSunMap({ grid: state.result.grid, minutes: sampleMinutes(state.result) })
    ui.setSunMapStatus({ kind: 'ready', daylightMinutes: state.result.daylightMinutes, day: sunDay?.when ?? new Date() })
    showProbe()
  } else if (state.status === 'error') {
    ui.setHeadline({ kind: 'error' })
    if (sunMapOn) ui.setSunMapStatus({ kind: 'error', message: state.message })
  }
})
/** The estimate is its own layer on the sun map's floor overlay: asked after the synchronous changes of a pick are done. */
function requestDaylight() {
  if (!daylightOn || !site || !plan) return
  const { selected } = site
  const p = plan
  daylightJob.request({
    sceneVersion: sunScene.sceneVersion(),
    plan: p,
    floorY: floorBase(selected, p),
    occluders: () => sunScene.occluders(),
    glass: () => glassTriangles(facadeWalls(p, selected).glass),
  })
}

function showDaylightProbe() {
  if (!daylightResult || !probePoint) return
  const sample = sampleAt(daylightResult.grid, probePoint.x, probePoint.z)
  if (sample === undefined) return closeProbe()
  const df = daylightResult.df[sample]
  popover.showText(t('sun.dayHeadSpot', { df: fmt1Fixed(df) }), t('sun.daySpotDetail', { band: upFirst(bandWord(bandOf(df))) }), t('sun.dayAria'))
}

function dropSurfaceProbe() {
  if (!surfaceProbe) return
  surfaceProbe = undefined
  surfaceJob.stop()
}

/** The asked wall point's light: its sun on the shown day, or its daylight estimate. */
function requestSurface() {
  if (!surfaceProbe || !site || !plan || !sunDay) return
  const { selected } = site
  const p = plan
  const { at, room, daylight } = surfaceProbe
  surfaceJob.request({
    sceneVersion: sunScene.sceneVersion(),
    plan: p,
    floorY: floorBase(selected, p),
    point: at,
    normal: at.normal,
    room,
    ask: daylight ? { kind: 'daylight' } : { kind: 'sun', day: sunDay.when, lat: sunDay.lat, lon: sunDay.lon },
    occluders: () => sunScene.occluders(),
    glass: () => glassTriangles(facadeWalls(p, selected).glass),
  })
}

surfaceJob.onState((state) => {
  const probe = surfaceProbe
  if (!probe || !sunDay || state.status === 'idle') return
  const aria = t(probe.daylight ? 'sun.dayAria' : 'sun.spotAria')
  if (state.status === 'running') {
    if (probe.shown === 'working') return // progress: the box already says so
    probe.shown = 'working'
    popover.showText(t('sun.surfaceWorking'), t(probe.daylight ? 'sun.surfaceWorkingDay' : 'sun.surfaceWorkingSun'), aria)
  } else if (state.status === 'error') {
    probe.shown = 'answer'
    popover.showText(t('sun.surfaceError'), state.message, aria)
  } else {
    probe.shown = 'answer'
    const { answer } = state
    if (answer.kind === 'sun') popover.show(answer.stats, sunDay.strip, minutesOfDay(sunDay.when))
    else popover.showText(t('sun.dayHeadSpot', { df: fmt1Fixed(answer.df) }), t('sun.daySurfaceDetail', { band: upFirst(bandWord(bandOf(answer.df))) }), aria)
  }
  // The box waits, hidden, for the mark's place on screen: marking the point again reports it.
  sunScene.setProbe(probe.at)
})
daylightJob.onState((state) => {
  if (!daylightOn) return
  if (state.status === 'running') {
    daylightResult = undefined
    sunScene.setSunMap(null)
    if (popover.open && !surfaceProbe) closeProbe()
    ui.setDaylightStatus({ kind: 'computing', progress: state.progress })
  } else if (state.status === 'ready') {
    daylightResult = state.result
    sunScene.setSunMap({ grid: state.result.grid, minutes: state.result.df, colour: daylightColor })
    const { mean, dimShare } = summarize(state.result.df)
    ui.setDaylightStatus({ kind: 'ready', mean, dimShare })
    showDaylightProbe()
  } else if (state.status === 'error') ui.setDaylightStatus({ kind: 'error', message: state.message })
})
ui.onDaylight((on) => {
  heightRuler.hide()
  daylightOn = on
  if (on) {
    if (sunMapOn) ui.setSunMap(false) // both paint on the same floor overlay; one at a time
    if (suitOn) ui.setSuitability(false)
    sunScene.setSunMapVisible(true)
    requestDaylight()
  } else {
    daylightJob.stop()
    daylightResult = undefined
    closeProbe()
    sunScene.setSunMap(null)
    sunScene.setSunMapVisible(sunMapOn)
  }
})
ui.onSunMap((on) => {
  heightRuler.hide()
  sunMapOn = on
  if (on && suitOn) ui.setSuitability(false)
  if (on && daylightOn) ui.setDaylight(false)
  sunScene.setSunMapVisible(on)
  if (on) {
    if (sunResult && tracedCell <= CELL) {
      // The headline's trace is the sun map: paint it without tracing again.
      sunScene.setSunMap({ grid: sunResult.grid, minutes: sampleMinutes(sunResult) })
      ui.setSunMapStatus({ kind: 'ready', daylightMinutes: sunResult.daylightMinutes, day: sunDay?.when ?? new Date() })
    } else {
      sunResult = undefined // a coarse headline trace is no map to click on
      scheduleSunMap()
    }
  } else {
    if (view !== '3d') sunJob.stop() // in 3D the headline keeps the job and its result
    sunScene.setSunMap(null)
    closeProbe()
  }
})
sunScene.onSceneChange(() => {
  if (gardenSpot && !keepSpot) clearGardenSpot() // the spot belongs to the scene it was picked in
  if (findPlant) {
    // The plant map belongs to the scene too: trace the area again (the job's cache answers when only the view changed).
    findResult = undefined
    findPainted = ''
    findTrace = { status: 'running', progress: 0 }
    sunScene.setGardenMap(null)
    requestFind()
  }
  requestShade()
  sunKey = ''
  sunResult = undefined
  closeProbe()
  scheduleSunMap()
  requestDaylight()
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
  if (walking && view !== '3d') return // in Panels and Garden a click while walking picks for that view
  if (!at) return closeProbe()
  probeAt(at)
})
/** Marks a floor point and answers it: with the daylight estimate when that layer is on, else with the sun map. */
function probeAt(at: Point) {
  dropSurfaceProbe()
  probePoint = at
  sunScene.setProbe(at)
  if (daylightOn) {
    showDaylightProbe()
    return
  }
  // Walking, a click is a question about the sun map: it turns the map on, and the answer comes when it is ready.
  if (!sunMapOn) ui.setSunMap(true)
  const inGrid = sunResult !== undefined && sampleAt(sunResult.grid, at.x, at.z) !== undefined
  const outcome = probeOutcome(sunResult !== undefined, inGrid)
  if (outcome === 'show') showProbe()
  else if (outcome === 'close') closeProbe()
}
let walking = false
/** The camera of the scene views (Top, Outside, Inside), kept across tabs for the session. */
let camera: CameraMode = 'outside'
const inScene = (v: View): boolean => v === '3d' || v === 'panels' || v === 'garden' // one scene and one camera for all three
/** Esc: a first press closes the Garden's plant card, then its spot card, then an open popover; while walking the next one leaves walk mode. */
function escape() {
  const action = escapeAction({ walking, popoverOpen: popover.open, cardOpen: view === 'garden' && (!!plantCardId || !!gardenSpot) })
  if (action === 'close-card') {
    if (plantCardId) closePlantCard()
    else clearGardenSpot()
  } else if (action === 'close-popover') closeProbe()
  else if (action === 'exit-walk') sunScene.stopWalk()
}
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || walking) return
  if (heightPopover.isOpen) return heightPopover.hide()
  if (suitPopover.open) return closeSuitPick()
  if (plantCardId) return closePlantCard()
  if (view === 'garden' && gardenSpot) clearGardenSpot()
  else if (view === 'panels' && selectedPanel && !popover.open) selectPanel(null)
  else escape() // walking, the walk controls report Esc themselves
})
sunScene.onProbeScreen((at) => popover.moveTo(at))
if (import.meta.env.DEV) {
  Object.assign(window, {
    __sunpatch: { scene: sunScene, daylight: () => daylightResult, selectPanel, shadeJob, suit: () => suitResult, suitFigures: () => suitEnergy.map((e) => e.weather ?? e.ideal), plan: () => plan, result: () => sunResult, floorY: () => (site && plan ? floorBase(site.selected, plan) : 0) },
  })
}

sunScene.setWalkHandlers({
  change(isWalking) {
    walking = isWalking
    camera = cameraAfterWalk(camera, isWalking, inScene(view))
    ui.setCamera(shownCamera(view, camera))
    if (isWalking) heightRuler.hide()
    // The map belongs to the outside view: off for the walk, back after it if the user had it on.
    if (isWalking) {
      suitLeaving = true
      ui.setSuitability(false)
      suitLeaving = false
    } else if (view === 'panels' && suitWish) ui.setSuitability(true)
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
  yearCard.setMonth(when.getMonth())
  popover.setNow(minutesOfDay(when))
  // Only another day or place needs a new sun map; the time slider just moves along it.
  const key = `${dateKey(when)} ${place.lat} ${place.lon}`
  if (key !== sunKey) {
    sunKey = key
    scheduleSunMap()
    requestShade()
    if (surfaceProbe && !surfaceProbe.daylight) requestSurface()
  }
})
// A language switch reloads the page: the building, tab and time come back from the session it saved (src/session.ts).
const restored = takeSession()
let restoreView: View | undefined
onBeforeLangSwitch(() => {
  if (plan && !ephemeral()) savePlan(plan)
  if (!last || !sunDay) return
  saveSession({
    lat: last.clicked.lat, lon: last.clicked.lon, view, date: dateValue(sunDay.when), minutes: minutesOfDay(sunDay.when), example: exampleMode,
    // A shared copy is saved nowhere else: the reload carries it.
    ...(sharedMode && plan && { shared: plan }),
  })
})
const mapView = createMapView(document.body, restored ?? MILAN, pick, ui.searchSlot)
// ?example=milan: a bundled sample apartment; its edits are never saved, so a stored plan of the same building stays safe.
// A share link (#s=...) is read once and taken out of the address bar, so a reload does not reopen it over later edits.
const shareHash = location.hash.startsWith('#s=') ? location.hash : ''
if (shareHash) history.replaceState(null, '', location.pathname + location.search)
const fromQuery = new URLSearchParams(location.search).get('example') === 'milan' && (!restored || restored.example === true)
// A shared copy of the example has no ?example in its address: the session says it was the example.
let exampleMode = !shareHash && (fromQuery || (restored?.example === true && restored.shared !== undefined))
/**
 * The plan on screen came from a share link: it is shown like the example (never saved, the recipient's own plan for the
 * building untouched) until "Save as mine". `sharedPlan` is what the building load applies, and is dropped when the load ends.
 */
let sharedMode = false
/** The recipient of a shared copy has nothing of their own to share yet, so the Share box hides with it. */
function setSharedMode(on: boolean) {
  sharedMode = on
  ui.setShared(on)
}
let sharedPlan: Plan | undefined
const ephemeral = () => exampleMode || sharedMode
const sharedChip = createSharedChip(document.body)
const editor = createPlanEditor(document.body, setPlan, {
  autosave: () => !ephemeral(),
  onSwitch: (id, at) => switchTo(id, at),
  panelSummary: planSummary,
  onPanelSelect: selectPanel,
  contextMenu: sceneMenu,
})
sunScene.onPanelClick((id) => {
  if (view === 'panels') selectPanel(id) // in 3D a panel is just part of the scene
})
ui.onPanelPick(selectPanel)
sunScene.onPartClick(togglePartAt)
// The ruler is a 3D-view tool: Panels and Garden use a click on the roof for their own picks, which a ruler there would block.
sunScene.onBuildingHover((b, at) => {
  const note = b && !heightPopover.isOpen ? hoverNoteKind(sunScene.rulerContext(b), view === '3d') : null
  if (b && note && !heightRuler.dragging) hoverTip.show(hoverLines(b, note === 'ruler'), at)
  else hoverTip.hide()
  if (b && note === 'ruler') heightRuler.follow(b, at)
  else heightRuler.release()
})
// The context menu (right-click, or a long press on a touch screen): what can be done where it was opened.
sunScene.onSceneMenu((hit, at) => {
  hoverTip.hide()
  heightRuler.hide()
  const kind = hit.surface ? classifyHit(hit.surface) : null
  const spot = hit.surface && kind && kind !== 'cut' ? { kind, x: hit.surface.x, y: hit.surface.y, z: hit.surface.z } : undefined
  const piece = hit.furniture !== undefined ? plan?.furniture?.[hit.furniture] : undefined
  const floor = hit.floor
  const base = plan && site ? floorBase(site.selected, plan) : 0
  // A window seen from outside, a window box or a wall planter: "Plants for this spot" traces the point in front of it.
  const hung = piece && specOf(piece.kind).mounted ? piece : plan && hit.window?.outside ? windowBoxAt(plan, base, hit.window.index, '') : undefined
  const target = { floor: !!floor, spot: spot?.kind, building: !!hit.building, furniture: !!piece, mounted: !!piece && !!specOf(piece.kind).mounted, front: !!hung, window: !!hit.window, wall: !!hit.wall }
  const groups = sceneMenuItems(target, { hasPlan: !!plan, walking })
  const entry = (item: SceneMenuItem): MenuEntry => {
    switch (item) {
      case 'rotate': {
        const turned = { ...piece!, rot: (piece!.rot + 90) % 360 }
        const swap = (from: Furniture, to: Furniture) => (list: Furniture[]) => list.map((f) => (f === from ? to : f))
        return { label: t('menu.rotate'), run: () => editFurniture(swap(piece!, turned), swap(turned, piece!), t('menu.rotated', { name: upFirst(furnitureName(piece!)) })) }
      }
      case 'remove':
        return { label: t('menu.remove'), run: () => editFurniture((list) => list.filter((f) => f !== piece), (list) => [...list, piece!], t('menu.removed', { name: upFirst(furnitureName(piece!)) })) }
      case 'sun':
        return { label: t('menu.sun'), run: () => lightHere(floor!, false, hit.inner) }
      case 'daylight':
        return { label: t('menu.daylight'), run: () => lightHere(floor!, true, hit.inner) }
      case 'plants':
        return { label: t('menu.plants'), run: () => (hung ? mountHere(hung) : plantsHere(spot!)) }
      case 'addPlant': {
        // Inside the apartment (a sill too) the list is of house plants; the pot stands where the click was.
        const plants = MENU_PLANTS[floor ? 'indoor' : 'outdoor'].map((id) => plantById(id)!)
        return {
          label: t('menu.addPlant'),
          items: [
            ...plants.map((p) => ({ label: upFirst(plantName(p)), run: () => addPot(p, spot!) })),
            { label: t('menu.choosePlant'), run: () => {
              plantsHere(spot!)
              findPanel.el.querySelector<HTMLInputElement>('input')?.focus()
            } },
          ],
        }
      }
      case 'addWindowBox': {
        const index = hit.window!.index
        return mountEntry('menu.addWindowBox', MOUNT_PLANTS.windowbox, (id) => plan && windowBoxAt(plan, base, index, id))
      }
      case 'addWallPot': {
        const { face, n, height } = hit.wall!
        return mountEntry('menu.addWallPot', MOUNT_PLANTS.wallpot, (id) => plan && wallPotAt({ face, n }, base, plan.floorHeight, id, height))
      }
      case 'addFurniture':
        return {
          label: t('menu.addFurniture'),
          items: MENU_FURNITURE.map((kind) => ({ label: t(specOf(kind).name), run: () => {
            const added = newFurniture(kind, { x: snapMetres(floor!.x), z: snapMetres(floor!.z) })
            editFurniture((list) => [...list, added], (list) => list.filter((f) => f !== added), t('menu.added', { name: t(specOf(kind).name) }))
          } })),
        }
      case 'height':
        return { label: t('menu.height'), run: () => openHeight(site?.buildings.find((b) => b.id === hit.building), at) }
    }
  }
  // A facade offers nothing but the height: its box opens straight away, as a right-click on a building always did.
  if (groups.length === 1 && groups[0].length === 1 && groups[0][0] === 'height') return entry('height').run?.()
  sceneMenu.open(groups.map((g) => g.map(entry)), at)
})
/**
 * "Sun here" and "Indirect light here": the 3D view's probe at a floor point, with the layer it needs. On a wall, a sill
 * or a reveal (`surface`) the point itself is answered where the user is: no other view, camera or floor layer.
 */
function lightHere(at: Point, daylight: boolean, surface?: SurfacePoint) {
  if (surface) {
    closeProbe()
    surfaceProbe = { at: surface, room: at, daylight }
    sunScene.setProbe(surface)
    return requestSurface()
  }
  if (view !== '3d') setView('3d')
  if (daylight !== daylightOn) ui.setDaylight(daylight)
  probeAt(at)
}
/** "Plants for this spot": the Garden view with the spot picked. */
function plantsHere(spot: { kind: PickedKind; x: number; y: number; z: number }) {
  if (view !== 'garden') setView('garden')
  if (view === 'garden') selectGardenSpot(spot.kind, spot.x, spot.y, spot.z)
}
/** A window box or a wall planter hung by `make(plant)`: a few plants to pick, or Choose… for the Garden in front of it. */
function mountEntry(label: Key, plants: readonly string[], make: (plant: string) => Furniture | undefined): MenuEntry {
  return {
    label: t(label),
    items: [
      ...plants.map((id) => ({ label: upFirst(plantName(plantById(id)!)), run: () => addHung(make(id)) })),
      { label: t('menu.choosePlant'), run: () => {
        mountHere(make(''), make)
        findPanel.el.querySelector<HTMLInputElement>('input')?.focus()
      } },
    ],
  }
}
/** The Garden on the point in front of a hung piece (`at`, of any plant), where "Put a pot here" hangs `make(plant)`: by default another like it. */
function mountHere(at: Furniture | undefined, make = (plant: string): Furniture | undefined => at && { ...at, plant }) {
  if (!at) return
  const p = mountSpot(at)
  plantsHere({ kind: at.kind === 'wallpot' ? 'indoor' : p.y <= GROUND_TOP ? 'ground' : 'roof', ...p })
  if (gardenSpot?.x !== p.x || gardenSpot.z !== p.z) return // the Garden could not open
  spotMount = make
  renderPlantCard()
}
function addHung(piece: Furniture | undefined) {
  if (!piece || !plan || hasPot(plan.furniture, piece)) return
  editFurniture((list) => [...list, piece], (list) => list.filter((f) => f !== piece), t('menu.added', { name: upFirst(furnitureName(piece)) }))
}
function addPot(plant: Plant, spot: { kind: PickedKind; x: number; y: number; z: number }) {
  const pot = potAt(plant.id, spot, spot.kind === 'indoor')
  if (!plan || hasPot(plan.furniture, pot)) return
  editFurniture((list) => [...list, pot], (list) => list.filter((f) => !hasPot([f], pot)), t('menu.added', { name: upFirst(plantName(plant)) }))
}
ui.onEditHeight((at) => {
  const mine = site?.selected
  // A merged selection edits the part that sets its height: the tallest.
  openHeight(mine?.members ? [...mine.members].sort((a, b) => b.height - a.height)[0] : mine, at)
})
ui.onMarkGuessed((on) => sunScene.setMarkGuessed(on))
ui.onCountFurniture((on) => keepingSpot(() => sunScene.setCountFurniture(on)))
sunScene.onBuildingClick((id, at) => {
  // In Garden a click is a spot, not a wish to change building; in Panels with the suitability map a stray click must not drop the pick.
  const action = buildingClickAction(view, suitOn, touchOnly())
  if (action === 'switch') switchTo(id, at, true)
  // A tap is easy to make by accident (and starts orbits): it only offers the switch.
  else if (action === 'confirm') chip.done(t('shell.switchAsk'), { label: t('shell.switchYes'), run: () => switchTo(id, at, true) })
  else if (action === 'explain') chip.done(NEIGHBOUR_NOTE)
})
const chip = createStatusChip(app, () => last && void refine(last, current))
/** The user's height changes, kept by polygon id (30 days, on this device or just this session): see height-store.ts. */
const heightStore = createHeightStore()
// On opening, a note that the heights (and so the shadows) are estimates the user can correct; shown until dismissed.
showHeightsNote(document.body)
const keepChip = createKeepChip(app, (mode) => {
  heightStore.setMode(mode)
  showHeightsLine()
})
function showHeightsLine() {
  ui.setHeightsLine({ keep: heightStore.mode(), count: heightStore.count() })
}

// Starts on the map: there is nothing to show in 3D until a building is picked.
let view: View = 'map'
setView('map')
const restoredChecked = restored?.shared ? validatePlan(restored.shared) : undefined
const restoredShare = restoredChecked && 'plan' in restoredChecked ? restoredChecked.plan : undefined
if (shareHash && !restored) void openShare(shareHash)
else if (exampleMode) {
  if (restoredShare) void openExample(restoredShare, restored ?? undefined)
  else void openExample()
} else if (restored) {
  ui.setWhen(restored.date, restored.minutes)
  restoreView = restored.view
  if (restoredShare) sharedPlan = restoredShare
  // After the rest of the module has run: pick() touches state declared further down (`edited`, `last`).
  queueMicrotask(() => pick(restored.lat, restored.lon, true))
} else mapView.focusSearch() // the search is the first thing to do on the map

/** Opens a share link: the building at its point with the shared plan, on its date, time and tab; a bad link just says so. */
async function openShare(hash: string) {
  const result = await decodeShare(hash)
  if ('error' in result) {
    sharedChip.notice(t(result.error === 'version' ? 'shell.shareNewer' : 'shell.shareBroken'))
    mapView.focusSearch()
    return
  }
  const { share } = result
  ui.setWhen(share.date, share.minutes)
  if (share.example) {
    exampleMode = true
    await openExample(share.plan, share)
    return
  }
  restoreView = share.view
  sharedPlan = share.plan
  pick(share.lat, share.lon, true)
}

/** Save as mine: the shared plan becomes the recipient's own for this building (asking before replacing one). */
function saveShared() {
  if (!plan || !site || !sharedMode) return
  const mine = loadSavedPlan(plan.buildingId)
  if (mine && !confirm(t('shell.sharedSaveFirst'))) return
  savePlan(plan)
  heightStore.put(plan.heights)
  showHeightsLine()
  setSharedMode(false)
  exampleMode = false
  ui.setExample(false)
  sharedChip.notice(t('shell.sharedSaved'))
}

/** Start my own: leave the shared copy (the building keeps the recipient's own saved plan, if any) and go to the Map. */
function startOwn() {
  if (!site) return
  endShared()
  const mine = savedPlanFor(site.selected)
  setPlan(mine ? rebasePlan(withoutKey(mine), site.origin) : undefined)
  setView('map')
}

ui.onShare(() => void shareLink())

async function shareLink() {
  if (!plan || !last || !sunDay) return
  const hash = await encodeShare({
    lat: last.clicked.lat, lon: last.clicked.lon, view, date: dateValue(sunDay.when), minutes: minutesOfDay(sunDay.when), plan,
    ...(exampleMode && { example: true }),
  })
  const url = shareUrl(hash)
  try {
    if (touchOnly() && typeof navigator.share === 'function') {
      try {
        await navigator.share({ url })
      } catch (err) {
        if ((err as Error).name === 'AbortError') return // the user closed the sheet
        throw err
      }
    } else await navigator.clipboard.writeText(url)
    ui.setShareResult(t('shell.shareCopied'))
    window.setTimeout(() => ui.setShareResult(null), 4000)
  } catch {
    ui.setShareResult(t('shell.shareManual'), url) // no clipboard access: the link, selected, for the user to copy
  }
}

async function openExample(over?: Plan, shared?: { date: string; minutes: number; view: View }) {
  const { buildings, selected, origin, plan: examplePlan, elements, near } = await loadExample()
  loaded = { elements, center: near, radius: EXAMPLE_RADIUS_M }
  last = { clicked: near, origin } // a point inside the example building: Undo after switching away comes back to it
  show(buildings, selected, origin, false)
  placeTrees(elements, origin, site!.buildings)
  if (over) {
    setPlan(rebasePlan({ ...over, buildingId: selected.id, ...(selected.sources && { selection: selected.sources }) }, origin))
    setSharedMode(true)
    sharedChip.showShared(saveShared, startOwn)
  } else setPlan(examplePlan)
  ui.setWhen(shared?.date ?? EXAMPLE_WHEN.date, shared?.minutes ?? EXAMPLE_WHEN.minutes)
  ui.setExample(!over)
  setView(shared?.view ?? '3d')
  if (restored && !shared) {
    ui.setWhen(restored.date, restored.minutes)
    setView(restored.view)
  }
}

/** Puts the scene camera in the chosen mode; `asked` is the user's own pick (Inside then gets the whole floor when there is no plan). */
function applyCamera(asked = false) {
  if (camera === 'inside' && !plan && asked) ensurePlan(true)
  if (camera === 'inside' && !walking && !sunScene.startWalk()) camera = 'outside'
  if (camera !== 'inside') {
    sunScene.stopWalk()
    sunScene.setTopView(camera === 'top', frameTargetFor(view))
  }
  ui.setCamera(shownCamera(view, camera))
}

function chooseCamera(mode: CameraMode) {
  sceneMenu.close()
  const next = pickCamera(view, mode)
  camera = next.mode
  if (next.view !== view) setView(next.view, true)
  else if (inScene(view)) applyCamera(true)
  else ui.setCamera(shownCamera(view, camera))
}
ui.onCamera(chooseCamera)
// 1, 2 and 3 pick Top, Outside and Inside wherever the switcher shows (not while typing).
window.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement | null
  if (view === 'map' || target?.closest('input, textarea, select, [contenteditable="true"]')) return
  const mode = cameraForKey(e)
  if (!mode) return
  e.preventDefault()
  chooseCamera(mode)
})

/** The Panels and Garden views need a plan (panels to hold, a floor to stand on): the whole floor, as when the editor opens first. */
function ensurePlan(keepView = false): boolean {
  if (!site) return false
  if (!plan) setPlan(newPlan(), keepView)
  return true
}

/** What each scene view frames: the apartment (3D), the whole building (Panels), the apartment and the ground round it (Garden). */
const frameTargetFor = (v: View): FrameTarget => (v === 'panels' ? 'building' : v === 'garden' ? 'garden' : 'apartment')

/** `askedCamera`: the switcher sent the user here, so its camera is the user's own pick (see applyCamera). */
function setView(next: View, askedCamera = false) {
  const from = view
  if (next === 'plan' && !openEditor()) return
  if (next === 'panels' && !ensurePlan()) return
  if (next === 'garden' && !ensurePlan(true)) return // the camera stays where it is
  if (view === 'garden' && next !== 'garden') {
    clearGardenSpot()
    clearFind()
  }
  view = next
  heightPopover.hide()
  sceneMenu.close()
  hoverTip.hide()
  heightRuler.hide()
  const scene3d = inScene(next)
  sunScene.setGardenPicking(next === 'garden')
  sunScene.setWalkOnDoubleClick(next === '3d')
  app.hidden = !scene3d
  mapView.setVisible(next === 'map')
  editor.setVisible(next === 'plan')
  sunScene.setActive(scene3d)
  if (scene3d) sunScene.resize()
  // Opening a scene view shows its answer, unless the user has orbited since the camera was framed: the apartment
  // in 3D and Garden, the whole building in Panels (its map covers the facades and the roof).
  if (scene3d && from !== next) sunScene.frameOnEntry(frameTargetFor(next))
  // The camera picked on the switcher holds in every scene view: a walk goes on from 3D into Garden, Top stays Top.
  if (scene3d) applyCamera(askedCamera)
  else ui.setCamera(shownCamera(next, camera))
  // The map belongs to the Panels view: it goes off when leaving and comes back (recomputed if the scene changed) on return.
  if (next !== 'panels') {
    suitLeaving = true
    ui.setSuitability(false)
    suitLeaving = false
  } else if (suitWish) ui.setSuitability(true)
  ui.setView(next)
  if (next === '3d') scheduleSunMap()
  else requestYear()
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
let loaded: { elements: OverpassElement[]; center: { lat: number; lon: number }; radius: number } | undefined
/** How far around the building the neighbours are loaded and simulated (the Details menu; kept in localStorage). */
let hoodRadius = neighborhoodRadius('medium')
/** The next refine keeps the building (and its trimmed or added parts) on screen instead of flooding from the click again: a size change. */
let keepSelection = false
/** Chip text to show instead of the usual one when the current load ends (set when switching buildings). */
let note: string | undefined
const SWITCHED = t('shell.switched')
/** What "Undo" after a scene-click switch goes back to: a point inside the old building, its plan and the view. */
interface SwitchUndo {
  at: { lat: number; lon: number }
  plan: Plan | undefined
  exampleMode: boolean
  sharedMode: boolean
  view: View
}
const switchUndo = createUndoSlot<SwitchUndo>()
/** The Undo button of the chip for a beyond-the-data switch, shown when the new building's load ends. */
let noteAction: ChipAction | undefined
const switchedTo = (b: Building) => {
  const name = buildingLine(b).title
  return name ? t('shell.switchedTo', { name }) : t('shell.switchedPlain')
}

function pick(lat: number, lon: number, fromShare = false) {
  exampleMode = false // from here on it is the user's own building: plans load and save as usual
  if (!fromShare) endShared()
  ui.setExample(false)
  edited = false
  keepSelection = false
  loaded = undefined
  note = undefined
  noteAction = undefined
  switchUndo.clear()
  pending?.abort()
  chip.hide()
  const token = ++current
  const clicked = { lat, lon }
  // Instant preview from the vector tiles already on the map.
  const features = mapView.getTileBuildings()
  const hit = selectBuilding(tileBuildings(features, clicked, hoodRadius), project(lat, lon, clicked))
  last = { clicked }
  if (hit) {
    const origin = unproject(ringCentroid(hit.outer), clicked)
    const buildings = tileBuildings(features, origin, hoodRadius)
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
let site: { /** Every polygon the data has around the origin, however far. */ full: Building[]; /** `full` within the neighbourhood radius, as the data has them. */ raw: Building[]; /** `raw` with the user's heights applied: what the scene shows. */ buildings: Building[]; selected: Building; origin: Origin } | undefined
siteDeclared = true
ui.onCutaway((hidden) => {
  heightRuler.hide() // its handle must not sit over a floor that is now the target
  floorsHidden = hidden
  gardenHint = undefined // the roof note asked for exactly this
  renderGarden() // the roof counts of the plant map follow
})
/** The user's own heights, by polygon id: kept with the plan (`plan.heights`) and carried to the next building shown. */
let heights: HeightOverrides = {}
const sameHeights = (a: HeightOverrides | undefined, b: HeightOverrides | undefined) => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {})

/** The trees of the loaded green areas, within the neighbourhood (and no farther than the tree scatter goes). */
function placeTrees(elements: OverpassElement[], origin: Origin, buildings: Building[]) {
  sunScene.setTrees(scatterTrees(parseGreen(elements, origin), buildings, { radius: Math.min(TREE_RADIUS_M, hoodRadius) }))
}

function show(full: Building[], picked: Building, origin: Origin, keepCamera: boolean) {
  const raw = withinRadius(full, hoodRadius, picked.sources ?? [picked.id])
  // The OSM refinement replaces the tile preview of the same building: carry its plan over.
  const carried = plan && site && plan.buildingId === site.selected.id && keepCamera
  const saved = carried ? null : planFor(picked)
  // The store is the truth (a share link's heights are shown over it, never written to it); a refinement keeps the edits made on its preview.
  const resolved = carried ? { ...heightStore.load(), ...heights, ...plan!.heights } : resolveHeights(heightStore, saved?.heights, !!sharedPlan)
  heights = keepKnown(resolved, raw) ?? {}
  const buildings = applyHeights(raw, heights)
  const selected = reselect(buildings, picked)
  site = { full, raw, buildings, selected, origin }
  sunScene.setBuildings(buildings, selected, { keepCamera, radiusM: hoodRadius })
  ui.setNeighborhoodLine(neighborhoodLine(countBuildings(buildings), hoodRadius))
  if (carried) setPlan({ ...withHeights(rebasePlan(plan!, origin)), buildingId: selected.id, selection: selected.sources })
  else setPlan(saved ? withHeights(rebasePlan(withoutKey(saved), origin)) : undefined)
  if (saved?.heights && !sharedPlan && !carried && plan) savePlan(plan) // older plans handed their heights to the store: saved without them now
  showHeightsLine()
  if (saved && sharedPlan && !carried) {
    setSharedMode(true)
    sharedChip.showShared(saveShared, startOwn)
  }
  ui.setLocation(origin.lat, origin.lon)
  ui.setBuildingInfo(selected)
  ui.setBuildingPicked(true)
  mapView.setSelection(selectionGeoJSON(selected, origin))
  if (view === 'plan') openEditor()
  else if (view !== 'panels' && view !== 'garden') setView('3d') // these views stay put when another building is picked in 3D
  if (restoreView) {
    const back = restoreView
    restoreView = undefined
    setView(back)
  }
}

const NEIGHBOR_RADIUS_M = 60

/**
 * The Neighbourhood menu: a new size re-filters the buildings already loaded when they reach far enough (shrinking
 * always does), otherwise it asks Overpass for the bigger circle (a cached bigger answer is reused). Either way the scene
 * version moves, so the sun map, panels and garden recompute.
 */
function setNeighborhood(id: NeighborhoodId) {
  const radius = neighborhoodRadius(id)
  if (radius === hoodRadius) return
  hoodRadius = radius
  if (!site) return
  const data = loaded
  const away = data ? project(site.origin.lat, site.origin.lon, data.center) : undefined
  if (data && away && covers(data.radius, Math.hypot(away.x, away.z), radius)) {
    show(site.full, site.selected, site.origin, true)
    placeTrees(data.elements, site.origin, site.buildings)
  } else if (last) {
    pending?.abort()
    keepSelection = true
    void refine(last, ++current)
  }
}
ui.onNeighborhood(setNeighborhood)
ui.onHeightsChange(() => keepChip.ask())
ui.onHeightsReset(() => {
  const n = heightStore.count()
  if (!n || !confirm(t('shell.heightsResetConfirm', { n }))) return
  heightStore.clear()
  stripSavedHeights()
  keepChip.hide()
  heights = {}
  if (site) {
    const before = site.selected
    site.buildings = applyHeights(site.raw, {})
    site.selected = reselect(site.buildings, before)
    sunScene.setBuildings(site.buildings, site.selected, { keepCamera: true })
    ui.setBuildingInfo(site.selected)
    if (plan) {
      const now = site.selected
      let updated = withHeights(plan)
      if (before.height !== now.height || before.minHeight !== now.minHeight || before.levels !== now.levels) {
        updated = { ...updated, floorHeight: defaultFloorHeight(now), floor: Math.min(updated.floor, levelCount(now) - 1) }
      }
      editingHeight = true
      setPlan(updated, true)
      editingHeight = false
      if (!ephemeral()) savePlan(updated)
    }
  }
  showHeightsLine()
  chip.done(t('shell.heightsResetDone'))
})

/** The building at the click: the flood fill, or the parts a saved plan recorded (older plans have none). */
function choose(buildings: Building[], origin: Origin, clicked: { lat: number; lon: number }): Building | undefined {
  const at = project(clicked.lat, clicked.lon, origin)
  const flooded = selectBuilding(buildings, at)
  const saved = flooded ? planFor(flooded) : null
  if (!flooded || !saved?.selection) return flooded
  return restoreSelection(buildings, at, { id: saved.originalId, ids: saved.selection }) ?? flooded
}

/**
 * Click on another building in 3D, or on a neighbour in the Plan: switch to it without going back to the map.
 * Inside the loaded data that is instant and needs no request; beyond it, it is a map pick at that spot (tile
 * preview, then Overpass). The plan being left is saved first, and the new building's own plan, if any, opens.
 */
function switchTo(polygonId: string, at: Point, undoable = false) {
  if (!site) return
  const before: SwitchUndo | undefined = undoable && last ? { at: last.clicked, plan, exampleMode, sharedMode, view } : undefined
  // Plans autosave on every edit; this also covers one carried over from the tile preview.
  if (plan && !ephemeral()) savePlan(plan)
  const ll = unproject(at, site.origin)
  const data = loaded
  const [dx, dz] = data ? [project(ll.lat, ll.lon, data.center).x, project(ll.lat, ll.lon, data.center).z] : [Infinity, 0]
  // The data holds the new building's whole neighbourhood only near its centre; as before, switch from it within REUSE_M short of its edge.
  if (!data || Math.hypot(dx, dz) > data.radius - REUSE_M) {
    pick(ll.lat, ll.lon)
    note = SWITCHED
    if (before) {
      switchUndo.set(before)
      noteAction = { label: t('shell.undo'), run: undoSwitch }
    }
    return
  }
  const flooded = selectBuilding(site.buildings, at)
  if (!flooded || (site.selected.sources ?? [site.selected.id]).includes(polygonId) || !site.buildings.some((b) => b.id === polygonId)) return
  exampleMode = false
  endShared()
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
  placeTrees(data.elements, origin, site!.buildings)
  switchUndo.clear()
  if (before) {
    switchUndo.set(before)
    chip.done(switchedTo(selected), { label: t('shell.undo'), run: undoSwitch })
  } else chip.done(SWITCHED)
  if (view === 'plan') editor.notify(SWITCHED) // the chip lives in the 3D view
}

/** "Undo" on the switch toast: back to the previous building with its plan and view. */
function undoSwitch() {
  const back = switchUndo.take()
  if (!back || !site) return
  const at = project(back.at.lat, back.at.lon, site.origin)
  const old = selectBuilding(site.buildings, at)
  if (!old) return pick(back.at.lat, back.at.lon)
  switchTo(old.id, at)
  if (back.exampleMode && back.plan && site) {
    exampleMode = true
    ui.setExample(true)
    setPlan(rebasePlan(back.plan, site.origin), true)
  }
  if (back.sharedMode && back.plan && site) {
    setSharedMode(true)
    setPlan(rebasePlan(back.plan, site.origin), true)
    sharedChip.showShared(saveShared, startOwn)
  }
  if (back.view !== view) setView(back.view)
  chip.done(t('shell.switchedBack'))
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
  show(site.raw, result.selected, site.origin, true)
  if (plan && !ephemeral()) savePlan(plan)
}

/** The plan to open on a building: the one a share link brought while it loads, else the user's saved one (never the example's). */
function planFor(b: Building): (Plan & { originalId: string }) | null {
  if (sharedPlan) return { ...sharedPlan, buildingId: b.id, originalId: sharedPlan.buildingId }
  return exampleMode ? null : savedPlanFor(b)
}

/** The user left the shared copy (another building, another pick): back to plans that save as usual. */
function endShared() {
  sharedPlan = undefined
  setSharedMode(false)
  sharedChip.hide()
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
  const { buildings, selected } = site
  const hidden = hiddenOutlines(buildings)
  const own = new Set(selected.sources ?? [selected.id])
  const c = ringCentroid(selected.outer)
  const neighbors = buildings.filter(
    (b) => !own.has(b.id) && !hidden.has(b.id) && distanceToRing(b.outer, c) < NEIGHBOR_RADIUS_M,
  )
  if (!plan) setPlan(newPlan())
  editor.open(selected, neighbors, plan!, selectedPanel)
  return true
}

/** The plan with the heights now in the scene (what a share link carries). */
function withHeights(p: Plan): Plan {
  const { heights: _, ...rest } = p
  return { ...rest, ...(Object.keys(heights).length ? { heights } : {}) }
}

/** The whole floor of the selected building, carrying the heights set so far. */
function newPlan(): Plan {
  return { ...defaultPlan(site!.selected, site!.origin), ...(Object.keys(heights).length ? { heights } : {}) }
}

/** Opens the Height box for a polygon (right-click, or the building line's button). */
function openHeight(b: Building | undefined, at: { x: number; y: number }) {
  if (!b) return
  hoverTip.hide()
  heightRuler.hide()
  heightPopover.open(b, at)
}

/**
 * Sets (or, with null, resets) one polygon's height. The scene, shadows, sun map, panel shading and suitability follow
 * through the scene version; the overrides are saved with the plan, which is created for the selected building if
 * there is none yet. A changed selected building gets its storey height and floor count from the new height.
 */
function setHeight(id: string, override: HeightOverride | null) {
  if (!site) return
  const next = { ...heights }
  if (override) next[id] = override
  else delete next[id]
  heights = next
  if (!sharedMode) {
    // A shared copy is only looked at: its heights reach the store with "Save as mine".
    const firstTime = override && heightStore.mode() === undefined
    heightStore.set(id, override)
    if (firstTime) keepChip.ask()
    showHeightsLine()
  }
  const before = site.selected
  site.buildings = applyHeights(site.raw, heights)
  site.selected = reselect(site.buildings, before)
  const now = site.selected
  sunScene.setBuildings(site.buildings, now, { keepCamera: true })
  ui.setBuildingInfo(now)
  const { heights: _, ...rest } = plan ?? newPlan()
  let updated: Plan = { ...rest, ...(Object.keys(heights).length ? { heights } : {}) }
  if (before.height !== now.height || before.minHeight !== now.minHeight || before.levels !== now.levels) {
    updated = { ...updated, floorHeight: defaultFloorHeight(now), floor: Math.min(updated.floor, levelCount(now) - 1) }
  }
  editingHeight = true
  setPlan(updated, true)
  editingHeight = false
  if (!ephemeral()) savePlan(updated)
  chip.done(override ? t(touchOnly() ? 'shell.heightSetTouch' : 'shell.heightSet') : t('shell.heightReset'))
}

/** A height edit is on its way through setPlan: the plan already says what the heights are. */
let editingHeight = false

/** keepView leaves the camera where it is; otherwise the first plan of a building is framed. */
function setPlan(next: Plan | undefined, keepView = false) {
  // A plan imported with other heights brings them in (over the stored ones, which every plan sees).
  const wanted = next && site && !editingHeight ? keepKnown({ ...heightStore.load(), ...next.heights }, site.raw) : undefined
  if (next && site && !editingHeight && !sameHeights(wanted, heights)) {
    heights = wanted ?? {}
    site.buildings = applyHeights(site.raw, heights)
    site.selected = reselect(site.buildings, site.selected)
    sunScene.setBuildings(site.buildings, site.selected, { keepCamera: true })
    ui.setBuildingInfo(site.selected)
  }
  plan = next
  sunScene.setPlan(next ?? null, { keepView })
  ui.setPlanActive(next !== undefined)
  ui.setHasFurniture(!!next?.furniture?.length)
  ui.setNextStep(nextStep(next, site?.selected))
}

/** Replaces the preview with the detailed Overpass buildings; ignored if a newer pick started. */
async function refine({ clicked, origin }: Pick, token: number) {
  const hasPreview = origin !== undefined
  pending = new AbortController()
  if (hasPreview) chip.loading()
  try {
    const data = await fetchBuildingData(clicked.lat, clicked.lon, { signal: pending.signal, radiusM: hoodRadius })
    const { elements } = data
    if (token !== current) return
    let sceneOrigin = origin
    if (!sceneOrigin) {
      // No preview: centre on the building found, as the preview would have.
      const first = selectBuilding(parseOverpass(elements, clicked).buildings, project(clicked.lat, clicked.lon, clicked))
      if (first) sceneOrigin = unproject(ringCentroid(first.outer), clicked)
    }
    if (!sceneOrigin) {
      mapView.setStatus(t('shell.noBuilding'), 'error')
      return
    }
    const { buildings } = parseOverpass(elements, sceneOrigin)
    // Parts the user trimmed or added on the preview carry over to the OSM polygons that cover them.
    const at = project(clicked.lat, clicked.lon, sceneOrigin)
    const keep = keepSelection
    keepSelection = false
    const selected = hasPreview && (edited || keep) && site ? carrySelection(buildings, site.selected, at) : choose(buildings, sceneOrigin, clicked)
    if (!selected) {
      // Nothing in OSM under the click: the preview stays.
      if (hasPreview) chip.done(t('shell.chipLoadedNone'))
      else mapView.setStatus(t('shell.noBuilding'), 'error')
      return
    }
    loaded = { elements, center: data.center, radius: data.radius }
    show(buildings, selected, sceneOrigin, hasPreview)
    placeTrees(elements, sceneOrigin, site!.buildings)
    if (hasPreview) chip.done(note ?? t('shell.chipLoaded'), noteAction)
  } catch (err) {
    if (token !== current) return
    if (hasPreview) chip.failed(t('shell.chipFailed'))
    else mapView.setStatus((err as Error).message, 'error')
  } finally {
    if (token === current) {
      mapView.setLoading(false)
      sharedPlan = undefined // the load is over: the shared plan is the plan on screen now, not a source for other buildings
    }
  }
}
