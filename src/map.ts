import { Map as MapLibreMap, NavigationControl, setWorkerUrl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'

// MapLibre looks for its worker next to its own module, but Vite bundles that module
// elsewhere (dev deps cache, build chunks), so the worker 404s and the map stays blank.
setWorkerUrl(workerUrl)

const STYLE = 'https://tiles.openfreemap.org/styles/liberty'
const NOMINATIM = 'https://nominatim.openstreetmap.org/search'

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

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault()
    const q = input.value.trim()
    if (!q) return
    setStatus('Searching...')
    try {
      const res = await fetch(`${NOMINATIM}?format=json&limit=1&q=${encodeURIComponent(q)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const hits = (await res.json()) as { lat: string; lon: string }[]
      if (!hits.length) {
        setStatus(`No place found for "${q}".`, 'error')
        return
      }
      map.flyTo({ center: [Number(hits[0].lon), Number(hits[0].lat)], zoom: 17 })
      setStatus('Click on a building to pick it.')
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
