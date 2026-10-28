import SunCalc from 'suncalc'
import type { Building } from './osm'
import type { SunDirection } from './sun'
import { activePreset, dateValue, daylight, nextPlayMinute, presetDates, startMinutes, stripGradient, STEP, DAY_MAX, type Daylight } from './daylight'
import { compassName, sunDirection } from './sun'

/** One 24-hour HH:MM format for every time shown in the app. */
export const TIME_FORMAT: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: false }

const MILAN = { lat: 45.4642, lon: 9.19 }

export type View = 'map' | 'plan' | '3d'

export interface UI {
  setLocation(lat: number, lon: number): void
  /** Where the place search form is mounted (the Map view panel). */
  readonly searchSlot: HTMLElement
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
  /** Sets the date (YYYY-MM-DD) and the time of day in minutes. */
  setWhen(date: string, minutes: number): void
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
    <a id="about" href="../" title="About Sunpatch">&larr; Sunpatch</a>
    <nav id="views">
      <button type="button" data-view="map">Map</button>
      <button type="button" data-view="plan" disabled title="Pick a building first">Plan</button>
      <button type="button" data-view="3d" disabled title="Pick a building first">3D</button>
    </nav>
    <section data-views="map">
      <h2>Find your building</h2>
      <div id="searchSlot"></div>
    </section>
    <div id="building" hidden></div>
    <p class="hint" data-views="map">Click a building on the map to pick it.</p>
    <p class="hint" data-views="plan">Draw your apartment's outline, then add windows.</p>
    <section data-views="3d">
      <div id="aptTools" hidden>
        <label class="row"><input id="cutaway" type="checkbox" checked> Hide floors above</label>
        <button id="walk" class="primary" type="button" title="Stand inside the apartment (or double-click its floor in 3D)">Walk inside</button>
      </div>
      <div class="field">
        <label for="date">Date</label>
        <div id="presets" role="group" aria-label="Date presets"></div>
        <input id="date" type="date" value="${dateValue(now)}">
      </div>
      <div class="field">
        <label class="split" for="time">Time <span id="timeLabel"></span></label>
        <div id="timeTrack">
          <div id="dayStrip" aria-hidden="true"></div>
          <input id="time" type="range" min="0" max="${DAY_MAX}" step="${STEP}" value="${startMinutes(now, MILAN.lat, MILAN.lon)}">
        </div>
      </div>
      <button id="play" type="button">Play</button>
      <div id="sunSummary"></div>
      <details id="location">
        <summary>Location</summary>
        <label>Latitude <input id="lat" type="number" step="0.0001" min="-90" max="90" value="${MILAN.lat}"></label>
        <label>Longitude <input id="lon" type="number" step="0.0001" min="-180" max="180" value="${MILAN.lon}"></label>
      </details>
      <p class="note">Times use your browser's time zone.</p>
    </section>`
  document.body.appendChild(panel)

  const $ = <T extends HTMLElement>(id: string) => panel.querySelector<T>('#' + id)!
  const lat = $<HTMLInputElement>('lat')
  const lon = $<HTMLInputElement>('lon')
  const date = $<HTMLInputElement>('date')
  const time = $<HTMLInputElement>('time')
  const play = $<HTMLButtonElement>('play')
  const summary = $('sunSummary')
  const presetBox = $('presets')
  const strip = $('dayStrip')
  presetBox.addEventListener('click', (e) => {
    const chip = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-date]')
    if (!chip) return
    date.value = chip.dataset.date!
    refresh()
  })
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

  /** Daylight of the shown day; recomputed only when the day or place changes. */
  let day: { key: string; info: Daylight } | undefined
  let chipKey = ''

  function refresh() {
    const when = currentDate()
    const la = lat.valueAsNumber
    const lo = lon.valueAsNumber
    $('timeLabel').textContent = formatMinutes(Number(time.value))
    if (!when || Number.isNaN(la) || Number.isNaN(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) {
      summary.textContent = 'Invalid latitude, longitude or date'
      summary.removeAttribute('title')
      return
    }
    const key = `${date.value} ${la} ${lo}`
    if (day?.key !== key) {
      day = { key, info: daylight(when, la, lo) }
      strip.style.background = stripGradient(day.info.segments)
    }
    updatePresets(when.getFullYear(), la)
    const sun = sunDirection(when, la, lo)
    onSun(sun)
    listener?.(when, sun)
    const times = SunCalc.getTimes(new Date(when.getFullYear(), when.getMonth(), when.getDate(), 12), la, lo)
    const rise = formatTime(times.sunrise)
    const set = formatTime(times.sunset)
    strip.title = day.info.polar === 'day' ? 'Sun up all day' : day.info.polar === 'night' ? 'Sun below the horizon all day' : `Daylight ${rise} to ${set}`
    summary.title = `Azimuth ${sun.azimuthDeg.toFixed(1)} deg from north, altitude ${sun.altitudeDeg.toFixed(1)} deg`
    // Two deliberate lines instead of one that wraps at an arbitrary word.
    const { where, height } = sunParts(sun)
    summary.innerHTML =
      `<strong>${where}</strong>` +
      (height ? `<span>${height}</span>` : '') +
      `<span>${rise && set ? `Sunrise ${rise} \u00b7 Sunset ${set}` : 'No sunrise or sunset on this date'}</span>`
  }

  /** Rebuilds the chips when the year or hemisphere changes, and marks the one matching the date. */
  function updatePresets(year: number, la: number) {
    const presets = presetDates(year, la, new Date())
    const key = `${year} ${la < 0}`
    if (key !== chipKey) {
      chipKey = key
      presetBox.innerHTML = ''
      for (const p of presets) {
        const b = document.createElement('button')
        b.type = 'button'
        b.dataset.id = p.id
        b.dataset.date = p.date
        b.title = p.title
        b.textContent = p.label
        presetBox.appendChild(b)
      }
    }
    const active = activePreset(presets, date.value)
    for (const b of presetBox.querySelectorAll('button')) {
      b.dataset.date = presets.find((p) => p.id === b.dataset.id)!.date
      b.setAttribute('aria-pressed', String(b.dataset.id === active))
    }
  }

  let timer: number | undefined
  /** One Play step: inside the daylight window, looping from sunset back to sunrise. */
  function playStep() {
    if (!day) return
    time.value = String(nextPlayMinute(Number(time.value), day.info))
    refresh()
  }
  play.addEventListener('click', () => {
    if (timer !== undefined) {
      stop()
      return
    }
    play.textContent = 'Pause'
    playStep()
    timer = window.setInterval(playStep, 50)
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
    searchSlot: $('searchSlot'),
    setBuildingInfo(b) {
      const el = $('building')
      el.hidden = !b
      if (b) el.innerHTML = buildingInfoHtml(b)
    },
    setView(view) {
      for (const b of viewButtons) {
        b.classList.toggle('active', b.dataset.view === view)
        if (b.dataset.view === view) b.setAttribute('aria-current', 'page')
        else b.removeAttribute('aria-current')
      }
      for (const el of panel.querySelectorAll<HTMLElement>('[data-views]')) {
        el.hidden = !el.dataset.views!.split(' ').includes(view)
      }
      panel.dataset.view = view
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
      panel.classList.toggle('walking', walking)
    },
    stepTime(minutes) {
      time.value = String((((Number(time.value) + minutes) % 1440) + 1440) % 1440)
      refresh()
    },
    setWhen(d, minutes) {
      date.value = d
      time.value = String(minutes)
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
    `<strong>Selected building</strong>` +
    `<br>${source}` +
    `<span class="detail"><br>` +
    `Height: ${b.height.toFixed(1)} m (${HEIGHT_SOURCE[b.heightSource]}${min})` +
    levels +
    `</span>`
  )
}

function formatMinutes(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}

/** 24-hour HH:MM, or '' when the date is missing (no sunrise or sunset). */
function formatTime(d: Date | null): string {
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleTimeString([], TIME_FORMAT) : ''
}

const WORDS: Record<string, string> = { N: 'north', E: 'east', S: 'south', W: 'west' }

/** The two halves of the sun sentence: where it is, and how high (empty while it is down). */
export function sunParts(sun: SunDirection, tail = 'above the horizon'): { where: string; height: string } {
  if (sun.altitudeDeg <= 0) return { where: 'Sun below the horizon', height: '' }
  const dir = [...compassName(sun.azimuthDeg)].map((c) => WORDS[c]).join('-')
  return { where: `Sun in the ${dir}`, height: `${sun.altitudeDeg.toFixed(0)}\u00b0 ${tail}` }
}

/** Plain-language sun position; `tail` ends the sentence after the altitude in degrees. */
export function sunSentence(sun: SunDirection, tail = 'above the horizon'): string {
  const { where, height } = sunParts(sun, tail)
  return height ? `${where}, ${height}` : where
}
