import { Map as MapLibreMap, NavigationControl, setWorkerUrl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { hitLabel, searchUrl, viewFor, type GeoHit } from './geocode'

// MapLibre looks for its worker next to its own module, but Vite bundles that module
// elsewhere (dev deps cache, build chunks), so the worker 404s and the map stays blank.
setWorkerUrl(workerUrl)

const STYLE = 'https://tiles.openfreemap.org/styles/liberty'

export interface MapView {
  setVisible(visible: boolean): void
  /** Shows a status line; pass '' to clear. */
  setStatus(text: string, kind?: 'info' | 'error'): void
  setLoading(loading: boolean): void
}

export function createMapView(
  container: HTMLElement,
  start: { lat: number; lon: number },
  onPick: (lat: number, lon: number) => void,
): MapView {
  const root = document.createElement('div')
  root.id = 'mapView'
  root.innerHTML = `
    <div id="mapCanvas"></div>
    <form id="search">
      <input name="q" type="search" placeholder="Search a place" aria-label="Search a place">
      <button type="submit">Search</button>
      <ul id="results" hidden></ul>
    </form>
    <div id="mapStatus" hidden></div>`
  container.appendChild(root)

  const map = new MapLibreMap({
    container: root.querySelector<HTMLElement>('#mapCanvas')!,
    style: STYLE,
    center: [start.lon, start.lat],
    zoom: 16,
    pitch: 45,
  })
  map.addControl(new NavigationControl(), 'bottom-right')
  map.on('click', (e) => onPick(e.lngLat.lat, e.lngLat.lng))

  const status = root.querySelector<HTMLElement>('#mapStatus')!
  const form = root.querySelector<HTMLFormElement>('#search')!
  const input = form.querySelector<HTMLInputElement>('input')!

  function setStatus(text: string, kind: 'info' | 'error' = 'info') {
    status.hidden = !text
    status.textContent = text
    status.dataset.kind = kind
  }

  const results = form.querySelector<HTMLUListElement>('#results')!

  function closeResults() {
    results.hidden = true
    results.replaceChildren()
  }

  function showResults(hits: GeoHit[]) {
    results.replaceChildren(...hits.map((hit) => {
      const li = document.createElement('li')
      li.tabIndex = 0
      const name = document.createElement('span')
      name.textContent = hit.display_name
      const kind = document.createElement('small')
      kind.textContent = hitLabel(hit)
      li.append(name, kind)
      const choose = () => { closeResults(); goTo(hit) }
      li.addEventListener('click', choose)
      li.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') choose() })
      return li
    }))
    results.hidden = false
  }

  function goTo(hit: GeoHit) {
    const view = viewFor(hit)
    if ('bounds' in view) map.fitBounds(view.bounds, { maxZoom: 18 })
    else map.flyTo({ center: [Number(hit.lon), Number(hit.lat)], zoom: view.zoom })
    setStatus('Click on a building to pick it.')
  }

  input.addEventListener('input', closeResults)
  form.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeResults() })

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault()
    const q = input.value.trim()
    if (!q) return
    closeResults()
    setStatus('Searching...')
    try {
      const b = map.getBounds()
      const url = searchUrl(q, [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], navigator.language)
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const hits = (await res.json()) as GeoHit[]
      if (!hits.length) {
        setStatus(`No place found for "${q}".`, 'error')
        return
      }
      showResults(hits)
      setStatus('Choose a result to go there.')
    } catch (err) {
      setStatus(`Place search failed (${(err as Error).message}).`, 'error')
    }
  })

  setStatus('Click on a building to pick it.')

  return {
    setVisible(visible) {
      root.hidden = !visible
      if (visible) map.resize()
    },
    setStatus,
    setLoading(loading) {
      root.classList.toggle('loading', loading)
      if (loading) setStatus('Loading buildings from OpenStreetMap...')
    },
  }
}
