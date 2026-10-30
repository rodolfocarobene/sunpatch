import './style.css'
import { createMapView } from './map'
import { createStatusChip, type ChipAction } from './chip'
import { buildingClickAction, createUndoSlot, NEIGHBOUR_NOTE } from './switch-undo'
import { buildingLine } from './building-line'
import { createPlanEditor, loadSavedPlan, savePlan } from './editor'
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
import { applyHeights, keepKnown, reselect, type HeightOverride, type HeightOverrides } from './heights'
import { createHeightPopover, createHoverTip } from './height-popover'
import { createHeightRuler } from './height-ruler'
import { hoverLines } from './building-line'
import { createScene, type FrameTarget } from './scene'
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
import { createSuitabilityJob, type SuitabilityResult } from './suitability-job'
import { createSuitabilityPopover } from './suitability-popover'
import { createGardenJob, GARDEN_AREA_SLOT_MINUTES, type GardenResult, type GardenState } from './garden-job'
import { discSpots, gardenSpots, meanSun, roofSpots } from './garden-spots'
import { insideOutline } from './walk-geom'
import { bestSpot, findDeadEnd, roofNoteVisible, spotPlace, findSummary, monthCounts, kindsFor, kindStats, stepOf, surfaceY, type Scored } from './garden-find'
import { createFindPanel } from './garden-find-panel'
import { MONTH_NAMES, type DeadEnd } from './garden-text'
import { scoreSpots } from './garden'
import { plantById, type Plant } from './plants'
import { classifyHit, CUT_HINT, FACADE_HINT, type PickedKind } from './garden-pick'
import { createGardenCard, type GardenCardInput } from './garden-card'
import { IRRADIATION_STRIDE, panelFor, rampScale, surfaceEnergy, surfaceSamples, suitabilityColor, suitabilityText, type SurfaceEnergy } from './suitability'
import { createSunMapPopover } from './sunmap-popover'
import { sampleAt, sampleMinutes, spotStats, type SunMapResult } from './sunmap'
import { createUI, type View } from './ui'
import { escapeAction, probeOutcome } from './probe'
import { createWalkHud } from './walk'
import { onBeforeLangSwitch, t } from './i18n'
import { saveSession, takeSession } from './session'

const MILAN = { lat: 45.4642, lon: 9.19 }
const dateKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`

const app = document.querySelector<HTMLDivElement>('#app')!
const sunScene = createScene(app)
const ui = createUI((sun) => sunScene.update(sun), setView, (on) => sunScene.setCutaway(on), walkInside)
const hud = createWalkHud(app, ui.dock, { exit: () => sunScene.stopWalk() })
// Sun map: computed in a worker for the shown date, painted on the floor, and read by clicking the floor.
const sunJob = createSunMapJob()
const popover = createSunMapPopover(app, closeProbe)
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
})
const heightPopover = createHeightPopover(document.body, { onApply: setHeight, onReset: (id) => setHeight(id, null) })
let sunMapOn = false
let sunResult: SunMapResult | undefined
/** Where the user clicked, kept so the popover can be redone when the result changes. */
let plan: Plan | undefined // declared early: the sun callback below can fire before the building is picked
let probePoint: Point | undefined
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
  if (findPlant) gardenCardOpen = false
  renderGarden()
}
const findJob = createGardenJob() // the plant map's whole-area trace; the clicked spot has the job above, so neither stops the other
const findPanel = createFindPanel({
  onPlant: (id) => setFindPlant(id ? plantById(id) : undefined),
  onMonth: setGardenMonth,
  onBest: () => showBestSpot(),
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
})
ui.gardenSlot.appendChild(gardenCard.el)
let gardenSpot: { kind: PickedKind; x: number; y: number; z: number; neighbourRoof: boolean } | undefined
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
  findPainted = ''
  gardenCardOpen = plant === undefined
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
    if (!waiting) summary = findSummary(plant.name, gardenMonth === null ? null : MONTH_NAMES[gardenMonth], stats, centre)
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
  })
  renderGarden()
}

gardenJob.onState((state: GardenState) => {
  if (!gardenSpot) return
  gardenTrace =
    state.status === 'running' ? { status: 'running', progress: state.progress }
    : state.status === 'done' ? { status: 'done', sunMinutes: meanSun(state.result.spots) }
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
  selectGardenSpot(kind, hit.x, hit.y, hit.z)
})

/** A spot of the Garden view becomes the picked one (by a click, or "Show the best spot"): its card traces and rates the plants. */
function selectGardenSpot(kind: PickedKind, x: number, y: number, z: number, openCard = true) {
  gardenHint = undefined
  if (openCard) gardenCardOpen = true
  // A roof outside the picked building's footprints belongs to a neighbour.
  const own = site ? (site.selected.members ?? [site.selected]).some((m) => buildingContains(m, { x, z })) : true
  gardenSpot = { kind, x, y, z, neighbourRoof: kind === 'roof' && !own }
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
ui.onReframe(() => sunScene.frameView(frameTargetFor(view)))
sunScene.setFrameInset(() => document.getElementById('panel')?.getBoundingClientRect().right ?? 0)
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
  if (gardenSpot) clearGardenSpot() // the spot belongs to the scene it was picked in
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
  if (heightPopover.isOpen) return heightPopover.hide()
  if (suitPopover.open) return closeSuitPick()
  if (view === 'garden' && gardenSpot) clearGardenSpot()
  else if (view === 'panels' && selectedPanel && !popover.open) selectPanel(null)
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
    if (isWalking) heightRuler.hide()
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
// A language switch reloads the page: the building, tab and time come back from the session it saved (src/session.ts).
const restored = takeSession()
let restoreView: View | undefined
onBeforeLangSwitch(() => {
  if (plan && !exampleMode) savePlan(plan)
  if (!last || !sunDay) return
  saveSession({ lat: last.clicked.lat, lon: last.clicked.lon, view, date: dateValue(sunDay.when), minutes: minutesOfDay(sunDay.when), example: exampleMode })
})
const mapView = createMapView(document.body, restored ?? MILAN, pick, ui.searchSlot)
// ?example=milan: a bundled sample apartment; its edits are never saved, so a stored plan of the same building stays safe.
let exampleMode = new URLSearchParams(location.search).get('example') === 'milan' && (!restored || restored.example === true)
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
// The ruler is a 3D-view tool: Panels and Garden use a click on the roof for their own picks, which a ruler there would block.
sunScene.onBuildingHover((b, at) => {
  const ruler = view === '3d' && !heightPopover.isOpen
  if (b && !heightPopover.isOpen && !heightRuler.dragging) hoverTip.show(hoverLines(b, ruler), at)
  else hoverTip.hide()
  if (b && ruler) heightRuler.follow(b, at)
  else heightRuler.release()
})
sunScene.onBuildingMenu((id, at) => openHeight(site?.buildings.find((b) => b.id === id), at))
ui.onEditHeight((at) => {
  const mine = site?.selected
  // A merged selection edits the part that sets its height: the tallest.
  openHeight(mine?.members ? [...mine.members].sort((a, b) => b.height - a.height)[0] : mine, at)
})
ui.onMarkGuessed((on) => sunScene.setMarkGuessed(on))
sunScene.onBuildingClick((id, at) => {
  // In Garden a click is a spot, not a wish to change building; in Panels with the suitability map a stray click must not drop the pick.
  const action = buildingClickAction(view, suitOn)
  if (action === 'switch') switchTo(id, at, true)
  else if (action === 'explain') chip.done(NEIGHBOUR_NOTE)
})
const chip = createStatusChip(app, () => last && void refine(last, current))

// Starts on the map: there is nothing to show in 3D until a building is picked.
let view: View = 'map'
setView('map')
if (exampleMode) void openExample()
else if (restored) {
  ui.setWhen(restored.date, restored.minutes)
  restoreView = restored.view
  pick(restored.lat, restored.lon)
} else mapView.focusSearch() // the search is the first thing to do on the map

async function openExample() {
  const { buildings, selected, origin, plan: examplePlan, elements, near } = await loadExample()
  loaded = { elements, center: near, radius: EXAMPLE_RADIUS_M }
  last = { clicked: near, origin } // a point inside the example building: Undo after switching away comes back to it
  show(buildings, selected, origin, false)
  placeTrees(elements, origin, site!.buildings)
  setPlan(examplePlan)
  ui.setWhen(EXAMPLE_WHEN.date, EXAMPLE_WHEN.minutes)
  ui.setExample(true)
  setView('3d')
  if (restored) {
    ui.setWhen(restored.date, restored.minutes)
    setView(restored.view)
  }
}

function walkInside() {
  setView('3d')
  sunScene.startWalk()
}

/** The Panels and Garden views need a plan (panels to hold, a floor to stand on): the whole floor, as when the editor opens first. */
function ensurePlan(keepView = false): boolean {
  if (!site) return false
  if (!plan) setPlan(newPlan(), keepView)
  return true
}

/** What each scene view frames: the apartment (3D), the whole building (Panels), the apartment and the ground round it (Garden). */
const frameTargetFor = (v: View): FrameTarget => (v === 'panels' ? 'building' : v === 'garden' ? 'garden' : 'apartment')

function setView(next: View) {
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
  hoverTip.hide()
  heightRuler.hide()
  const scene3d = next === '3d' || next === 'panels' || next === 'garden' // one scene and one camera for all three
  sunScene.setGardenPicking(next === 'garden')
  app.hidden = !scene3d
  mapView.setVisible(next === 'map')
  editor.setVisible(next === 'plan')
  sunScene.setActive(scene3d)
  if (scene3d) sunScene.resize()
  // Opening a scene view shows its answer, unless the user has orbited since the camera was framed: the apartment
  // in 3D and Garden, the whole building in Panels (its map covers the facades and the roof).
  if (scene3d && from !== next) sunScene.frameOnEntry(frameTargetFor(next))
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
  view: View
}
const switchUndo = createUndoSlot<SwitchUndo>()
/** The Undo button of the chip for a beyond-the-data switch, shown when the new building's load ends. */
let noteAction: ChipAction | undefined
const switchedTo = (b: Building) => {
  const name = buildingLine(b).title
  return name ? t('shell.switchedTo', { name }) : t('shell.switchedPlain')
}

function pick(lat: number, lon: number) {
  exampleMode = false // from here on it is the user's own building: plans load and save as usual
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
  floorsHidden = hidden
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
  const saved = carried || exampleMode ? null : savedPlanFor(picked)
  heights = keepKnown({ ...heights, ...(carried ? plan!.heights : saved?.heights) }, raw) ?? {}
  const buildings = applyHeights(raw, heights)
  const selected = reselect(buildings, picked)
  site = { full, raw, buildings, selected, origin }
  sunScene.setBuildings(buildings, selected, { keepCamera, radiusM: hoodRadius })
  ui.setNeighborhoodLine(neighborhoodLine(countBuildings(buildings), hoodRadius))
  if (carried) setPlan({ ...rebasePlan(plan!, origin), buildingId: selected.id, selection: selected.sources })
  else setPlan(saved ? rebasePlan(withoutKey(saved), origin) : undefined)
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
function switchTo(polygonId: string, at: Point, undoable = false) {
  if (!site) return
  const before: SwitchUndo | undefined = undoable && last ? { at: last.clicked, plan, exampleMode, view } : undefined
  // Plans autosave on every edit; this also covers one carried over from the tile preview.
  if (plan && !exampleMode) savePlan(plan)
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
  setPlan(updated, true)
  if (!exampleMode) savePlan(updated)
  chip.done(override ? t('shell.heightSet') : t('shell.heightReset'))
}

/** keepView leaves the camera where it is; otherwise the first plan of a building is framed. */
function setPlan(next: Plan | undefined, keepView = false) {
  // A plan imported with other heights brings them in.
  if (next && site && !sameHeights(next.heights, heights)) {
    heights = keepKnown(next.heights, site.raw) ?? {}
    site.buildings = applyHeights(site.raw, heights)
    site.selected = reselect(site.buildings, site.selected)
    sunScene.setBuildings(site.buildings, site.selected, { keepCamera: true })
    ui.setBuildingInfo(site.selected)
  }
  plan = next
  sunScene.setPlan(next ?? null, { keepView })
  ui.setPlanActive(next !== undefined)
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
    if (token === current) mapView.setLoading(false)
  }
}
