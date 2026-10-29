import SunCalc from 'suncalc'
import type { Building } from './osm'
import type { SunDirection } from './sun'
import { activePreset, dateValue, daylight, snapMinutes, nextPlayMinute, presetDates, startMinutes, stripGradient, STEP, DAY_MAX, type Daylight } from './daylight'
import { compassName, sunDirection } from './sun'
import type { NextStep } from './next-step'

const ACCURACY_URL = 'https://github.com/rodolfocarobene/sunpatch#accuracy-and-limitations'
const GUIDE_KEY = 'sunpatch.guide'

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
  /** Shows what to do next on the apartment (Plan hint, 3D button); derived from the plan by the caller. */
  setNextStep(step: NextStep): void
  /** Shows the sample-apartment note (Plan and 3D views) until it is dismissed. */
  setExample(on: boolean): void
  /** Shows the cutaway toggle while an apartment plan is in the 3D scene. */
  setPlanActive(active: boolean): void
  /** The "Hide floors above" state, shared with the walk HUD: set it, flip it, or hear about changes. */
  setCutaway(on: boolean): void
  toggleCutaway(): void
  onCutaway(listener: (hidden: boolean) => void): void
  /** Disables the Walk button while walking. */
  setWalking(walking: boolean): void
  /** Time controls for the walk-mode keys; the UI keeps the time state. */
  stepTime(minutes: number): void
  togglePlay(): void
  /** Sets the date (YYYY-MM-DD) and the time of day in minutes. */
  setWhen(date: string, minutes: number): void
  /** Sets the time of day from the walk slider (minutes, snapped) and stops Play. */
  setMinutes(minutes: number): void
  /** Called after every sun update with the date and time, and the day strip's CSS background. */
  onChange(listener: (when: Date, sun: SunDirection, strip: string) => void): void
  /** Called when Play starts or stops. */
  onPlaying(listener: (playing: boolean) => void): void
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
    <div data-views="map" id="firstRun">
      <details id="guide" open>
        <summary>How it works</summary>
        <ol>
          <li aria-current="step"><strong>Pick your building</strong><span>Search, or click it on the map.</span></li>
          <li>Draw your apartment and windows</li>
          <li>See the sun come in</li>
        </ol>
      </details>
      <a id="exampleLink" href="?example=milan">Try the Milan example</a>
    </div>
    <p class="hint" id="mapHint" data-views="map" hidden></p>
    <div data-views="plan 3d">
      <div id="exampleNote" hidden>
        <span>This is a sample apartment in Milan. Pick your own building on the Map.</span>
        <button id="exampleClose" type="button" aria-label="Dismiss note" title="Dismiss">
          <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        </button>
      </div>
    </div>
    <p class="hint" data-views="plan"><span id="planNext"></span> <button id="planToThree" class="link" type="button" hidden>See it in 3D</button></p>
    <section data-views="3d">
      <button id="nextStep" class="primary" type="button"></button>
      <div id="aptTools" hidden>
        <label class="row"><input id="cutaway" type="checkbox" checked> Hide floors above</label>
        <button id="walk" class="primary" type="button" hidden title="Stand inside the apartment (or double-click its floor in 3D)">Walk inside</button>
      </div>
      <div class="field">
        <label for="date">Date</label>
        <div id="presets" role="group" aria-label="Date presets"></div>
        <input id="date" type="date" value="${dateValue(now)}">
      </div>
      <div class="field">
        <label class="split" for="time">Time <span id="timeLabel" title="Times use your browser's time zone"></span></label>
        <div class="timeTrack">
          <div id="dayStrip" class="dayStrip" aria-hidden="true"></div>
          <input id="time" class="timeRange" type="range" min="0" max="${DAY_MAX}" step="${STEP}" value="${startMinutes(now, MILAN.lat, MILAN.lon)}">
        </div>
      </div>
      <button id="play" type="button">Play</button>
      <div id="sunSummary"></div>
      <details id="location">
        <summary>Location</summary>
        <label>Latitude <input id="lat" type="number" step="0.0001" min="-90" max="90" value="${MILAN.lat}"></label>
        <label>Longitude <input id="lon" type="number" step="0.0001" min="-180" max="180" value="${MILAN.lon}"></label>
      </details>
      <p class="note">Direct sun only \u00b7 heights from OpenStreetMap. <a href="${ACCURACY_URL}" target="_blank" rel="noreferrer">Accuracy and limits</a></p>
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
  let cutawayListener: ((hidden: boolean) => void) | undefined
  const applyCutaway = () => {
    onCutaway(cutaway.checked)
    cutawayListener?.(cutaway.checked)
  }
  cutaway.addEventListener('change', applyCutaway)
  const walk = $<HTMLButtonElement>('walk')
  walk.addEventListener('click', onWalk)
  const nextButton = $<HTMLButtonElement>('nextStep')
  nextButton.addEventListener('click', () => onView('plan'))
  $('planToThree').addEventListener('click', () => onView('3d'))
  $('exampleClose').addEventListener('click', () => ($('exampleNote').hidden = true))

  // The first-run guide: open by default, its collapsed state is remembered.
  const guide = $<HTMLDetailsElement>('guide')
  const mapHint = $('mapHint')
  let picked = false
  try {
    if (localStorage.getItem(GUIDE_KEY) === 'closed') guide.open = false
  } catch { /* storage blocked: the guide just stays open */ }
  guide.addEventListener('toggle', () => {
    try {
      localStorage.setItem(GUIDE_KEY, guide.open ? 'open' : 'closed')
    } catch { /* not remembered */ }
    updateMapHint()
  })
  /** One line under the tabs; the open guide already says what to do, so it stays quiet then. */
  function updateMapHint() {
    $('firstRun').hidden = picked
    const text = picked ? 'Click another building to switch.' : guide.open ? '' : 'Pick a building to unlock Plan and 3D.'
    mapHint.textContent = text
    mapHint.hidden = !text || panel.dataset.view !== 'map'
  }
  let listener: ((when: Date, sun: SunDirection, strip: string) => void) | undefined
  let playListener: ((playing: boolean) => void) | undefined

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
    listener?.(when, sun, strip.style.background)
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
    playListener?.(true)
    playStep()
    timer = window.setInterval(playStep, 50)
  })
  function stop() {
    window.clearInterval(timer)
    timer = undefined
    play.textContent = 'Play'
    playListener?.(false)
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
      if (view === 'map') updateMapHint()
    },
    setBuildingPicked(isPicked) {
      picked = isPicked
      updateMapHint()
      for (const b of viewButtons) {
        if (b.dataset.view === 'map') continue
        b.disabled = !picked
        b.title = !picked
          ? 'Pick a building first'
          : b.dataset.view === 'plan' ? 'Draw your apartment on this building' : 'Sun and shadows in 3D'
      }
    },
    setNextStep(step) {
      $('planNext').textContent =
        step === 'outline' ? "Draw your apartment's outline, then place its windows."
        : step === 'windows' ? 'Now place windows on the outline.'
        : 'Windows placed.'
      $('planToThree').hidden = step !== 'see'
      nextButton.hidden = step === 'see'
      nextButton.textContent = step === 'outline' ? 'Next: draw your apartment' : 'Next: place the windows'
      // Walking needs windows; before that the Next prompt leads, and double-clicking the floor still works.
      walk.hidden = step !== 'see'
    },
    setExample(on) {
      $('exampleNote').hidden = !on
    },
    setPlanActive(active) {
      $('aptTools').hidden = !active
      if (active) applyCutaway()
    },
    setCutaway(on) {
      cutaway.checked = on
      applyCutaway()
    },
    toggleCutaway() {
      cutaway.checked = !cutaway.checked
      applyCutaway()
    },
    onCutaway(fn) {
      cutawayListener = fn
      fn(cutaway.checked)
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
    setMinutes(minutes) {
      stop()
      time.value = String(snapMinutes(minutes))
      refresh()
    },
    onPlaying(fn) {
      playListener = fn
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
  const parts = b.members?.length ?? 1
  const lead = parts > 1 ? `Your building: ${parts} parts \u00b7 ` : ''
  // One line per view: the map keeps its wording, 3D and Plan say how to switch.
  const hint =
    `<span class="viewHint" data-hint="map">${parts > 1 ? `${lead}Shift-click in 3D to add or remove parts` : 'Shift-click a neighbour in 3D to add it'}</span>` +
    `<span class="viewHint" data-hint="3d">${lead}Click another building to switch \u00b7 Shift-click to add/remove parts</span>` +
    `<span class="viewHint" data-hint="plan">${lead}With Select, click a grey building to switch</span>`
  const capped = b.capped ? '<br>Stopped at a large selection; shift-click to trim it.' : ''
  return (
    `<strong>Selected building</strong>` +
    `<br>${source}` +
    `<br><span class="parts">${hint}</span>${capped}` +
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
