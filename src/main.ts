import './style.css'
import { createMapView } from './map'
import { createStatusChip } from './chip'
import { parseOverpass, project, ringCentroid, snapBuilding, unproject, type Building, type Origin } from './osm'
import { fetchBuildingElements, RADIUS_M } from './overpass'
import { createScene } from './scene'
import { tileBuildings } from './tiles'
import { createUI, type View } from './ui'

const MILAN = { lat: 45.4642, lon: 9.19 }

const app = document.querySelector<HTMLDivElement>('#app')!
const sunScene = createScene(app)
const ui = createUI((sun) => sunScene.update(sun), () => setView(view === 'map' ? '3d' : 'map'))
const mapView = createMapView(document.body, MILAN, pick)
const chip = createStatusChip(app, () => last && void refine(last, current))

// Starts on the M1 test scene until a building is picked.
let view: View = '3d'
setView('3d')

function setView(next: View) {
  view = next
  app.hidden = next !== '3d'
  mapView.setVisible(next === 'map')
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

function pick(lat: number, lon: number) {
  pending?.abort()
  chip.hide()
  const token = ++current
  const clicked = { lat, lon }
  // Instant preview from the vector tiles already on the map.
  const features = mapView.getTileBuildings()
  const hit = snapBuilding(tileBuildings(features, clicked, RADIUS_M), project(lat, lon, clicked))
  last = { clicked }
  if (hit) {
    const origin = unproject(ringCentroid(hit.outer), clicked)
    const buildings = tileBuildings(features, origin, RADIUS_M)
    const selected = buildings.find((b) => b.id === hit.id)!
    last.origin = origin
    show(buildings, selected, origin, false)
    mapView.setLoading(false)
  } else {
    mapView.setLoading(true)
  }
  void refine(last, token)
}

function show(buildings: Building[], selected: Building, origin: Origin, keepCamera: boolean) {
  sunScene.setBuildings(buildings, selected.id, { keepCamera })
  ui.setLocation(origin.lat, origin.lon)
  ui.setBuildingInfo(selected)
  setView('3d')
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
      const first = snapBuilding(parseOverpass(elements, clicked).buildings, project(clicked.lat, clicked.lon, clicked))
      if (first) sceneOrigin = unproject(ringCentroid(first.outer), clicked)
    }
    if (!sceneOrigin) {
      mapView.setStatus('No building here, click on a building', 'error')
      return
    }
    const { buildings } = parseOverpass(elements, sceneOrigin)
    const selected = snapBuilding(buildings, project(clicked.lat, clicked.lon, sceneOrigin))
    if (!selected) {
      // Nothing in OSM under the click: the preview stays.
      if (hasPreview) chip.done('Detailed OSM data loaded (no OSM building at this point)')
      else mapView.setStatus('No building here, click on a building', 'error')
      return
    }
    show(buildings, selected, sceneOrigin, hasPreview)
    if (hasPreview) chip.done('Detailed OSM data loaded')
    else mapView.setStatus('Click on a building to pick it.')
  } catch (err) {
    if (token !== current) return
    if (hasPreview) chip.failed('Showing map-tile buildings (OpenStreetMap server unavailable)')
    else mapView.setStatus((err as Error).message, 'error')
  } finally {
    if (token === current) mapView.setLoading(false)
  }
}
