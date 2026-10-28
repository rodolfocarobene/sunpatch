import './style.css'
import { createMapView } from './map'
import { parseOverpass, pickBuilding, project, ringCentroid, unproject } from './osm'
import { fetchBuildingElements } from './overpass'
import { createScene } from './scene'
import { createUI, type View } from './ui'

const MILAN = { lat: 45.4642, lon: 9.19 }

const app = document.querySelector<HTMLDivElement>('#app')!
const sunScene = createScene(app)
const ui = createUI((sun) => sunScene.update(sun), () => setView(view === 'map' ? '3d' : 'map'))
const mapView = createMapView(document.body, MILAN, pick)

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

let busy = false

async function pick(lat: number, lon: number) {
  if (busy) return
  busy = true
  mapView.setLoading(true)
  try {
    const elements = await fetchBuildingElements(lat, lon)
    const clicked = { lat, lon }
    const hit = pickBuilding(parseOverpass(elements, clicked).buildings, project(lat, lon, clicked))
    if (!hit) {
      mapView.setStatus('No building here, click on a building', 'error')
      return
    }
    // Re-project around the building centroid so it sits at the scene origin.
    const origin = unproject(ringCentroid(hit.outer), clicked)
    const { buildings } = parseOverpass(elements, origin)
    const selected = buildings.find((b) => b.id === hit.id)!
    sunScene.setBuildings(buildings, selected.id)
    ui.setLocation(origin.lat, origin.lon)
    ui.setBuildingInfo(selected)
    mapView.setStatus('Click on a building to pick it.')
    setView('3d')
  } catch (err) {
    mapView.setStatus((err as Error).message, 'error')
  } finally {
    busy = false
    mapView.setLoading(false)
  }
}
