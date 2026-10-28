import SunCalc from 'suncalc'
import type { Building } from './osm'
import type { SunDirection } from './sun'
import { sunDirection } from './sun'

const MILAN = { lat: 45.4642, lon: 9.19 }

export type View = 'map' | 'plan' | '3d'

export interface UI {
  setLocation(lat: number, lon: number): void
  setBuildingInfo(building: Building | null): void
  setView(view: View): void
  /** Enables the Plan and 3D views once a building is selected. */
  setBuildingPicked(picked: boolean): void
  /** Shows the cutaway toggle while an apartment plan is in the 3D scene. */
  setPlanActive(active: boolean): void
  /** Disables the Walk button while walking. */
  setWalking(walking: boolean): void
  /** Time controls for the walk-mode keys; the UI keeps the time state. */
  stepTime(minutes: number): void
  togglePlay(): void
  /** Called after every sun update with the selected date and time. */
  onChange(listener: (when: Date, sun: SunDirection) => void): void
}

export function createUI(
  onSun: (sun: SunDirection) => void,
  onView: (view: View) => void,
  onCutaway: (on: boolean) => void,
  onWalk: () => void,
): UI {
  const now = new Date()
  const panel = document.createElement('div')
  panel.id = 'panel'
  panel.innerHTML = `
    <nav id="views">
      <button type="button" data-view="map">Map</button>
      <button type="button" data-view="plan" disabled title="Pick a building first">Plan</button>
      <button type="button" data-view="3d" disabled title="Pick a building first">3D</button>
    </nav>
    <div id="building"></div>
    <div id="aptTools" hidden>
      <label class="row"><input id="cutaway" type="checkbox" checked> Cutaway (hide floors above)</label>
      <button id="walk" type="button" title="Stand inside the apartment (or double-click its floor in 3D)">Walk inside</button>
    </div>
    <label>Latitude <input id="lat" type="number" step="0.0001" min="-90" max="90" value="${MILAN.lat}"></label>
    <label>Longitude <input id="lon" type="number" step="0.0001" min="-180" max="180" value="${MILAN.lon}"></label>
    <label>Date <input id="date" type="date" value="${toDateValue(now)}"></label>
    <label>Time <span id="timeLabel"></span>
      <input id="time" type="range" min="0" max="1435" step="5" value="${now.getHours() * 60 + Math.floor(now.getMinutes() / 5) * 5}">
    </label>
    <button id="play" type="button">Play</button>
    <small>Times are the local time of your browser. Azimuth is measured clockwise from north.</small>
    <pre id="readout"></pre>`
  document.body.appendChild(panel)

  const $ = <T extends HTMLElement>(id: string) => panel.querySelector<T>('#' + id)!
  const lat = $<HTMLInputElement>('lat')
  const lon = $<HTMLInputElement>('lon')
  const date = $<HTMLInputElement>('date')
  const time = $<HTMLInputElement>('time')
  const play = $<HTMLButtonElement>('play')
  const viewButtons = [...panel.querySelectorAll<HTMLButtonElement>('#views button')]
  for (const b of viewButtons) b.addEventListener('click', () => onView(b.dataset.view as View))
  const cutaway = $<HTMLInputElement>('cutaway')
  cutaway.addEventListener('change', () => onCutaway(cutaway.checked))
  const walk = $<HTMLButtonElement>('walk')
  walk.addEventListener('click', onWalk)
  let listener: ((when: Date, sun: SunDirection) => void) | undefined

  function currentDate(): Date | null {
    if (!date.value) return null
    const [y, m, d] = date.value.split('-').map(Number)
    const minutes = Number(time.value)
    return new Date(y, m - 1, d, Math.floor(minutes / 60), minutes % 60)
  }

  function refresh() {
    const when = currentDate()
    const la = lat.valueAsNumber
    const lo = lon.valueAsNumber
    $('timeLabel').textContent = formatMinutes(Number(time.value))
    if (!when || Number.isNaN(la) || Number.isNaN(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) {
      $('readout').textContent = 'Invalid latitude, longitude or date'
      return
    }
    const sun = sunDirection(when, la, lo)
    onSun(sun)
    listener?.(when, sun)
    const times = SunCalc.getTimes(when, la, lo)
    $('readout').textContent =
      `Azimuth   ${sun.azimuthDeg.toFixed(1)} deg\n` +
      `Altitude  ${sun.altitudeDeg.toFixed(1)} deg\n` +
      `Sunrise   ${formatTime(times.sunrise)}\n` +
      `Sunset    ${formatTime(times.sunset)}`
  }

  let timer: number | undefined
  play.addEventListener('click', () => {
    if (timer !== undefined) {
      stop()
      return
    }
    play.textContent = 'Pause'
    timer = window.setInterval(() => {
      const next = Number(time.value) + 5
      time.value = String(next > 1435 ? 0 : next)
      refresh()
    }, 50)
  })
  function stop() {
    window.clearInterval(timer)
    timer = undefined
    play.textContent = 'Play'
  }

  for (const el of [lat, lon, date, time]) el.addEventListener('input', refresh)
  time.addEventListener('input', stop)
  refresh()

  return {
    setLocation(la, lo) {
      lat.value = la.toFixed(5)
      lon.value = lo.toFixed(5)
      refresh()
    },
    setBuildingInfo(b) {
      const el = $('building')
      el.hidden = !b
      if (b) el.innerHTML = buildingInfoHtml(b)
    },
    setView(view) {
      for (const b of viewButtons) b.classList.toggle('active', b.dataset.view === view)
    },
    setBuildingPicked(picked) {
      for (const b of viewButtons) {
        if (b.dataset.view === 'map') continue
        b.disabled = !picked
        b.title = !picked
          ? 'Pick a building first'
          : b.dataset.view === 'plan' ? 'Draw your apartment on this building' : 'Sun and shadows in 3D'
      }
    },
    setPlanActive(active) {
      $('aptTools').hidden = !active
      if (active) onCutaway(cutaway.checked)
    },
    setWalking(walking) {
      walk.disabled = walking
    },
    stepTime(minutes) {
      time.value = String((((Number(time.value) + minutes) % 1440) + 1440) % 1440)
      refresh()
    },
    togglePlay() {
      play.click()
    },
    onChange(fn) {
      listener = fn
      refresh()
    },
  }
}

const HEIGHT_SOURCE = {
  tag: 'from height tag',
  levels: 'from levels x 3 m',
  default: 'default, no data',
  tile: 'from map tiles',
}

function buildingInfoHtml(b: Building): string {
  const osmPath = b.id.split('#')[0]
  const min = b.minHeight > 0 ? `, starts at ${b.minHeight.toFixed(1)} m` : ''
  const levels = b.levels !== undefined ? `<br>Levels: ${b.levels}` : '<br>Levels: unknown'
  const source = b.id.startsWith('tile/')
    ? 'Map-tile outline, not an OSM object'
    : `<a href="https://www.openstreetmap.org/${osmPath}" target="_blank" rel="noreferrer">OSM ${b.id}</a>`
  return (
    `<strong>Selected building</strong><br>` +
    `${source}<br>` +
    `Height: ${b.height.toFixed(1)} m (${HEIGHT_SOURCE[b.heightSource]}${min})` +
    levels
  )
}

function toDateValue(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function formatMinutes(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}

function formatTime(d: Date | null): string {
  return d && !Number.isNaN(d.getTime())
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : 'n/a (no event)'
}
