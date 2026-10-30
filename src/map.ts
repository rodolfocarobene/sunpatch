import { type GeoJSONSource, Map as MapLibreMap, Marker, NavigationControl, Popup, setWorkerUrl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { mapIdleHint, type SelectionCollection } from './map-selection'
import { buildingAt, highlightFeature, hitLabel, isBuildingLike, isStreetLevel, rankHits, searchUrl, viewFor, type GeoHit, type TileBuilding } from './geocode'

// MapLibre looks for its worker next to its own module, but Vite bundles that module
// elsewhere (dev deps cache, build chunks), so the worker 404s and the map stays blank.
setWorkerUrl(workerUrl)

const FOUND = 'found'
const PICKED = 'picked'
const STYLE = 'https://tiles.openfreemap.org/styles/liberty'

export interface MapView {
  setVisible(visible: boolean): void
  /** Shows a status line; pass '' to clear. */
  setStatus(text: string, kind?: 'info' | 'error'): void
  setLoading(loading: boolean): void
  /** `building` features of the vector tiles loaded so far (empty before the map has loaded). */
  getTileBuildings(): TileBuilding[]
  /** Puts the cursor in the place search. */
  focusSearch(): void
  /** Outlines the picked building on the map and drops the first-pick hint; pass empty features when none is picked. */
  setSelection(outline: SelectionCollection): void
}

export function createMapView(
  container: HTMLElement,
  start: { lat: number; lon: number },
  onPick: (lat: number, lon: number) => void,
  searchHost: HTMLElement,
): MapView {
  const root = document.createElement('div')
  root.id = 'mapView'
  root.innerHTML = `
    <div id="mapCanvas"></div>
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
  map.on('click', (e) => {
    clearFound()
    onPick(e.lngLat.lat, e.lngLat.lng)
  })

  const status = root.querySelector<HTMLElement>('#mapStatus')!
  const form = document.createElement('form')
  form.id = 'search'
  form.innerHTML = `
    <input name="q" type="search" placeholder="Address or place" aria-label="Search a place or address">
    <button type="submit">Search</button>
    <ul id="results" hidden></ul>`
  searchHost.appendChild(form)
  const input = form.querySelector<HTMLInputElement>('input')!

  function setStatus(text: string, kind: 'info' | 'error' = 'info') {
    status.hidden = !text
    status.textContent = text
    status.dataset.kind = kind
  }

  const results = form.querySelector<HTMLUListElement>('#results')!

  const marker = new Marker()
  let found = 0

  function whenStyleReady(fn: () => void) {
    if (map.isStyleLoaded()) fn()
    else map.once('idle', fn)
  }

  function setHighlight(feature: object | null) {
    whenStyleReady(() => {
      const data = { type: 'FeatureCollection', features: feature ? [feature] : [] } as never
      const source = map.getSource(FOUND) as GeoJSONSource | undefined
      if (source) {
        source.setData(data)
        return
      }
      map.addSource(FOUND, { type: 'geojson', data })
      // Areas (streets, cities) are outlined flat; a found building is redrawn as an orange block.
      const flat = ['!', ['has', 'height']] as never
      map.addLayer({ id: `${FOUND}-fill`, type: 'fill', source: FOUND, filter: flat, paint: { 'fill-color': '#e8590c', 'fill-opacity': 0.3 } })
      map.addLayer({ id: `${FOUND}-line`, type: 'line', source: FOUND, filter: flat, paint: { 'line-color': '#e8590c', 'line-width': 3 } })
      map.addLayer({
        id: `${FOUND}-3d`, type: 'fill-extrusion', source: FOUND, filter: ['has', 'height'],
        paint: {
          'fill-extrusion-color': '#e8590c',
          // Slightly taller than the basemap block so it is not hidden inside it.
          'fill-extrusion-height': ['+', ['get', 'height'], 0.3],
          'fill-extrusion-base': ['get', 'minHeight'],
          'fill-extrusion-opacity': 0.9,
        },
      })
    })
  }

  function setSelection(outline: SelectionCollection) {
    const picked = outline.features.length > 0
    if (picked) setStatus(mapIdleHint(true))
    whenStyleReady(() => {
      const source = map.getSource(PICKED) as GeoJSONSource | undefined
      if (source) {
        source.setData(outline as never)
        return
      }
      map.addSource(PICKED, { type: 'geojson', data: outline as never })
      map.addLayer({ id: `${PICKED}-fill`, type: 'fill', source: PICKED, paint: { 'fill-color': '#f5a623', 'fill-opacity': 0.25 } })
      map.addLayer({ id: `${PICKED}-line`, type: 'line', source: PICKED, paint: { 'line-color': '#f5a623', 'line-width': 3.5 } })
    })
  }

  function clearFound() {
    found++
    marker.remove()
    setHighlight(null)
  }

  function pickPopup(hit: GeoHit) {
    if (isStreetLevel(hit)) {
      // The point is the middle of a street piece, not a house: do not offer it as the building.
      const note = document.createElement('p')
      note.textContent = 'This is the street, not a house. Click the building on the map.'
      note.style.cssText = 'margin: 0; padding-right: 18px; max-width: 200px' // keeps the text clear of the close button
      return new Popup({ closeOnClick: false, offset: 24 }).setDOMContent(note)
    }
    const button = document.createElement('button')
    button.textContent = 'Use this building'
    button.addEventListener('click', (ev) => {
      ev.stopPropagation()
      clearFound()
      onPick(Number(hit.lat), Number(hit.lon))
    })
    return new Popup({ closeOnClick: false, offset: 24 }).setDOMContent(button)
  }

  function getTileBuildings(): TileBuilding[] {
    if (!map.getSource('openmaptiles')) return []
    return map.querySourceFeatures('openmaptiles', { sourceLayer: 'building' })
  }

  function highlightBuildingUnder(lngLat: [number, number], token: number, fallback: object | null) {
    // After the move, wait for idle so the zoom-18 building tiles are loaded.
    map.once('moveend', () => map.once('idle', () => {
      if (token !== found) return
      // Query the tile data rather than rendered pixels: in a pitched view the pixel at the
      // address can belong to a taller building in front of it.
      const b = buildingAt(getTileBuildings(), lngLat[0], lngLat[1])
      if (b) {
        setHighlight({
          type: 'Feature',
          properties: { height: b.height, minHeight: b.minHeight },
          geometry: { type: 'Polygon', coordinates: b.polygon },
        })
      } else if (fallback) {
        setHighlight(fallback)
      }
    }))
  }

  function closeResults() {
    results.hidden = true
    results.replaceChildren()
  }

  function showResults(hits: GeoHit[], q: string) {
    results.replaceChildren(...hits.map((hit) => {
      const li = document.createElement('li')
      li.tabIndex = 0
      const name = document.createElement('span')
      name.textContent = hit.display_name
      const kind = document.createElement('small')
      kind.textContent = hitLabel(hit, q)
      li.append(name, kind)
      const choose = () => { closeResults(); goTo(hit) }
      li.addEventListener('click', choose)
      li.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') choose() })
      return li
    }))
    results.hidden = false
  }
  function goTo(hit: GeoHit) {
    clearFound()
    const token = found
    const lngLat: [number, number] = [Number(hit.lon), Number(hit.lat)]
    marker.setLngLat(lngLat).setPopup(pickPopup(hit)).addTo(map).togglePopup()
    // A street is outlined as a line: snapping to the building nearest to it would show some other house.
    const outline = highlightFeature(hit)
    if (outline && (isStreetLevel(hit) || !isBuildingLike(hit))) setHighlight(outline)
    else highlightBuildingUnder(lngLat, token, outline)
    const view = viewFor(hit)
    const animate = !matchMedia('(prefers-reduced-motion: reduce)').matches
    if ('bounds' in view) map.fitBounds(view.bounds, { maxZoom: 18, animate })
    else map.flyTo({ center: lngLat, zoom: view.zoom, animate })
    setStatus('Click on a building to pick it.')
  }

  input.addEventListener('input', closeResults)
  form.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeResults() })

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault()
    const q = input.value.trim()
    if (!q) return
    closeResults()
    clearFound()
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
      showResults(rankHits(hits, q), q)
      setStatus('Choose a result to go there.')
    } catch (err) {
      setStatus(`Place search failed (${(err as Error).message}).`, 'error')
    }
  })

  setStatus(mapIdleHint(false))

  return {
    setVisible(visible) {
      root.hidden = !visible
      if (visible) map.resize()
    },
    setStatus,
    setSelection,
    getTileBuildings,
    focusSearch: () => input.focus(),
    setLoading(loading) {
      root.classList.toggle('loading', loading)
      if (loading) setStatus('Loading buildings from OpenStreetMap...')
    },
  }
}
