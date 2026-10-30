import SunCalc from 'suncalc'
import type { Building } from './osm'
import type { SunDirection } from './sun'
import { activePreset, dateValue, dayLabel, daylight, snapMinutes, nextPlayMinute, presetDates, startMinutes, stripGradient, STEP, DAY_MAX, type Daylight } from './daylight'
import { compassName, sunDirection } from './sun'
import type { NextStep } from './next-step'
import { ACCURACY_URL } from './panel-card'
import { duration, sunGradient } from './sunmap'
import { rangeText } from './suitability'
import { buildingLine } from './building-line'

const GUIDE_KEY = 'sunpatch.guide'
const SWITCH_HINT_KEY = 'sunpatch.switchHint'
const DETAILS_KEY = 'sunpatch.details'
const CLOSE_ICON =
  '<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>'

/** One 24-hour HH:MM format for every time shown in the app. */
export const TIME_FORMAT: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: false }

const MILAN = { lat: 45.4642, lon: 9.19 }

export type View = 'map' | 'plan' | '3d' | 'panels' | 'garden'

export type SunMapStatus =
  | { kind: 'computing'; progress: number }
  | { kind: 'ready'; daylightMinutes: number; day: Date }
  | { kind: 'error'; message: string }

export type SuitabilityStatus =
  | { kind: 'computing'; progress: number; updating?: boolean }
  | { kind: 'ready'; min: number; max: number; ticks: number[]; observed: [number, number]; weather: boolean; count: number }
  | { kind: 'error'; message: string }

export interface PanelList {
  items: { id: string; label: string; detail: string }[]
  selected: string | null
  total: string | null
}

export interface UI {
  setLocation(lat: number, lon: number): void
  /** Where the place search form is mounted (the Map view panel). */
  readonly searchSlot: HTMLElement
  setBuildingInfo(building: Building | null): void
  setView(view: View): void
  /** Enables the Plan, 3D and Panels views once a building is selected. */
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
  /** The "Mark guessed heights" switch (on by default): hear about it now and on every change. */
  onMarkGuessed(listener: (on: boolean) => void): void
  /** The selected building's Edit height button: hears where the button is on screen. */
  onEditHeight(listener: (at: { x: number; y: number }) => void): void
  /** The "Sun map" switch (off by default): hear about changes. */
  onSunMap(listener: (on: boolean) => void): void
  /** Sets or flips the switch (the walk panel, the M key and a floor click in walk mode use these). */
  setSunMap(on: boolean): void
  toggleSunMap(): void
  /** Fills the legend under the switch: progress while computing, the scale for the day, or an error. */
  setSunMapStatus(status: SunMapStatus): void
  /** The "Panel suitability" switch (off by default): hear about changes, set it, and fill the legend under it. */
  onSuitability(listener: (on: boolean) => void): void
  setSuitability(on: boolean): void
  setSuitabilityStatus(status: SuitabilityStatus): void
  /** Shows the legend's "Frame the building" button (the building is out of view) and hears its press. */
  setSuitabilityFrame(visible: boolean): void
  onSuitabilityFrame(listener: () => void): void
  /** The Panels view's list: one row per panel and the total line (null while the panels are still analysed). */
  setPanelList(list: PanelList): void
  /** A click on a row of the list. */
  onPanelPick(listener: (id: string) => void): void
  /** The bottom box with the date and time bar (3D view and walk mode); the walk key hints stack above it. */
  readonly dock: HTMLElement
  /** Where the panel card is docked: the Panels view of the left panel. */
  readonly cardSlot: HTMLElement
  /** Where the spot card is docked: the Garden view of the left panel. */
  readonly gardenSlot: HTMLElement
  /** Where the "Find a place for" plant picker is docked. */
  readonly gardenFindSlot: HTMLElement
  /** Where the shared Month control sits, between the spot card and the plant finder. */
  readonly gardenMonthSlot: HTMLElement
  /** The Garden section: marked while a spot is open, so the Month control rises above the card. */
  readonly gardenSection: HTMLElement
  /** Shows or hides the Garden view's line about picking the roof. */
  setRoofHint(show: boolean): void
  /** Disables the Walk button while walking. */
  setWalking(walking: boolean): void
  /** Time controls for the walk-mode keys; the UI keeps the time state. */
  stepTime(minutes: number): void
  togglePlay(): void
  /** Sets the date (YYYY-MM-DD) and the time of day in minutes. */
  setWhen(date: string, minutes: number): void
  /** Sets the time of day from the walk slider (minutes, snapped) and stops Play. */
  setMinutes(minutes: number): void
  /** Called after every sun update with the date and time, the day strip's CSS background and the place the sun was computed for. */
  onChange(listener: (when: Date, sun: SunDirection, strip: string, place: { lat: number; lon: number }) => void): void
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
      <button type="button" data-view="panels" disabled title="Pick a building first">Panels</button>
      <button type="button" data-view="garden" disabled title="Pick a building first">Garden</button>
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
    <div data-views="plan 3d" id="notes">
      <div id="note" class="noteBox" hidden>
        <div><p id="noteExample"></p><p id="noteHint"></p></div>
        <button id="noteClose" class="closeX" type="button" aria-label="Dismiss note" title="Dismiss">${CLOSE_ICON}</button>
      </div>
    </div>
    <p class="hint" data-views="plan"><span id="planNext"></span> <button id="planToThree" class="link next" type="button" hidden>See it in 3D</button></p>
    <section data-views="3d">
      <button id="nextStep" class="link next" type="button"></button>
      <div id="aptTools">
        <button id="walk" class="primary" type="button" hidden title="Stand inside the apartment (or double-click its floor in 3D)">Walk inside</button>
        <div class="field">
          <h3 class="groupHead">Show</h3>
          <div id="aptShow" hidden>
            <label class="row"><input id="cutaway" type="checkbox" checked> Hide floors above <kbd class="walkKey">H</kbd></label>
            <label class="row" title="Colour the floor by hours of direct sun on this date"><input id="sunMap" type="checkbox"> Sun map <kbd class="walkKey">M</kbd></label>
            <div id="sunMapLegend" hidden></div>
          </div>
        </div>
      </div>
      <details id="location">
        <summary>Details</summary>
        <div id="guessedBox">
          <label class="row" title="Stripe the buildings whose height OpenStreetMap does not have (a 9 m default is used)"><input id="guessed" type="checkbox" checked> Mark guessed heights</label>
          <p id="guessedLegend" class="legendNote"><i class="hatchKey" aria-hidden="true"></i>Hatched: height guessed (no data in OpenStreetMap)</p>
        </div>
        <div class="coords">
          <label>Latitude <input id="lat" type="number" step="0.0001" min="-90" max="90" value="${MILAN.lat}"></label>
          <label>Longitude <input id="lon" type="number" step="0.0001" min="-180" max="180" value="${MILAN.lon}"></label>
          <p class="note">Direct sun only \u00b7 heights from OpenStreetMap. <a href="${ACCURACY_URL}" target="_blank" rel="noreferrer">Accuracy and limits</a></p>
        </div>
      </details>
    </section>
    <section data-views="panels">
      <p id="panelLead" class="panelLead">Turn on Panel suitability, then click a roof, a facade or the ground to place a panel.</p>
      <div class="field">
        <label class="row" title="Colour the facade, roof and ground by the yearly energy a panel there would make"><input id="suit" type="checkbox"> Panel suitability</label>
        <div id="suitLegend" hidden></div>
        <button id="suitFrame" class="link" type="button" hidden>Frame the building</button>
      </div>
      <div id="panelList">
        <p id="panelTotals" class="hint" hidden></p>
        <ul id="panelRows" hidden></ul>
        <p id="panelEmpty" class="hint">Or draw one with the Panel tool in <button id="emptyToPlan" class="link" type="button">Plan</button>.</p>
      </div>
      <div id="cardSlot"></div>
    </section>
    <section data-views="garden" id="gardenSection">
      <div id="gardenSlot"></div>
      <div id="gardenMonthSlot"></div>
      <div class="field findGroup">
        <h3 class="groupHead">Or find a place for a plant</h3>
        <div id="gardenFindSlot"></div>
      </div>
      <div class="field">
        <label class="row" title="Hide the floors above the apartment to click its floor; show them to click the roof"><input id="gardenCutaway" type="checkbox" checked> Hide floors above</label>
        <p id="gardenRoofHint" class="cardNote small" hidden>Untick Hide floors above to see and pick the roof.</p>
      </div>
    </section>`
  document.body.appendChild(panel)
  // One docked bar for date and time, shared by the 3D view and walk mode (the walk key hints stack above it).
  const dock = document.createElement('div')
  dock.id = 'dock'
  dock.hidden = true
  dock.innerHTML = `
    <div id="timeBar" role="group" aria-label="Date and time">
      <div id="sunSummary"></div>
      <div class="barRow">
        <div id="presets" role="group" aria-label="Date presets"></div>
        <input id="date" type="date" aria-label="Date" value="${dateValue(now)}">
        <button id="play" type="button" title="Play the day (P)">Play</button>
      </div>
      <div class="barRow">
        <div class="timeTrack">
          <div id="dayStrip" class="dayStrip" aria-hidden="true"></div>
          <input id="time" class="timeRange" type="range" min="0" max="${DAY_MAX}" step="${STEP}" aria-label="Time of day" value="${startMinutes(now, MILAN.lat, MILAN.lon)}">
        </div>
        <span id="timeLabel" title="Times use your browser's time zone"></span>
      </div>
    </div>`
  document.body.appendChild(dock)

  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
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
  const guessed = $<HTMLInputElement>('guessed')
  let guessedListener: ((on: boolean) => void) | undefined
  guessed.addEventListener('change', () => {
    $('guessedLegend').hidden = !guessed.checked
    guessedListener?.(guessed.checked)
  })
  const cutaway = $<HTMLInputElement>('cutaway')
  let cutawayListener: ((hidden: boolean) => void) | undefined
  const applyCutaway = () => {
    gardenCutaway.checked = cutaway.checked
    onCutaway(cutaway.checked)
    cutawayListener?.(cutaway.checked)
  }
  cutaway.addEventListener('change', applyCutaway)
  // The Garden view has its own copy of the switch: it is the same state (the roof needs the floors above shown).
  const gardenCutaway = $<HTMLInputElement>('gardenCutaway')
  gardenCutaway.addEventListener('change', () => {
    cutaway.checked = gardenCutaway.checked
    applyCutaway()
  })
  const sunMap = $<HTMLInputElement>('sunMap')
  const legend = $('sunMapLegend')
  let sunMapListener: ((on: boolean) => void) | undefined
  const applySunMap = () => {
    legend.hidden = !sunMap.checked
    sunMapListener?.(sunMap.checked)
  }
  sunMap.addEventListener('change', applySunMap)
  const suit = $<HTMLInputElement>('suit')
  const suitLegend = $('suitLegend')
  const suitFrame = $('suitFrame')
  let suitFrameListener: (() => void) | undefined
  suitFrame.addEventListener('click', () => suitFrameListener?.())
  let suitListener: ((on: boolean) => void) | undefined
  const applySuit = () => {
    suitLegend.hidden = !suit.checked
    if (!suit.checked) suitFrame.hidden = true
    suitListener?.(suit.checked)
  }
  suit.addEventListener('change', applySuit)
  const walk = $<HTMLButtonElement>('walk')
  walk.addEventListener('click', onWalk)
  const nextButton = $<HTMLButtonElement>('nextStep')
  nextButton.addEventListener('click', () => onView('plan'))
  $('emptyToPlan').addEventListener('click', () => onView('plan'))
  let panelPickListener: ((id: string) => void) | undefined
  $('panelRows').addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-id]')
    if (row) panelPickListener?.(row.dataset.id!)
  })
  $('planToThree').addEventListener('click', () => onView('3d'))

  let editHeightListener: ((at: { x: number; y: number }) => void) | undefined
  $('building').addEventListener('click', (e) => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button.editHeight')
    if (!button) return
    const r = button.getBoundingClientRect()
    // Beside the panel, not over it: the box opens below the button, in the scene's space.
    editHeightListener?.({ x: panel.getBoundingClientRect().right + 8 + 136, y: r.bottom })
  })
  let hintGone = false
  let hasBuilding = false
  let building: Building | null = null
  try {
    hintGone = localStorage.getItem(SWITCH_HINT_KEY) === 'gone'
  } catch { /* storage blocked: the hint shows every time */ }
  // One note for the first visits: the sample-apartment line (this session only) and how to switch buildings
  // (once dismissed it stays away). One X closes both.
  let exampleOn = false
  let exampleGone = false
  $('noteClose').addEventListener('click', () => {
    hintGone = true
    exampleGone = true
    try {
      localStorage.setItem(SWITCH_HINT_KEY, 'gone')
    } catch { /* not remembered */ }
    updateNote()
  })
  function updateNote() {
    const view = panel.dataset.view
    const example = exampleOn && !exampleGone
    const hint = !hintGone
    const note = $('note')
    note.hidden = !hasBuilding || (view !== '3d' && view !== 'plan') || !(example || hint)
    if (note.hidden) return
    const parts = (building?.members?.length ?? 1) > 1
    $('noteExample').hidden = !example
    $('noteExample').textContent = 'Sample apartment in Milan. Pick your own building on the Map.'
    $('noteHint').hidden = !hint
    $('noteHint').textContent =
      view === 'plan' ? 'With Select, click a grey building to switch.' : `Click another building to switch. Shift\u2011click to add or remove parts${parts ? ' of your building' : ''}. Right\u2011click a building to set its height.`
  }

  // Details (guessed heights, location): closed by default; the open state lasts for the session.
  const details = $<HTMLDetailsElement>('location')
  try {
    details.open = sessionStorage.getItem(DETAILS_KEY) === 'open'
  } catch { /* storage blocked: closed */ }
  details.addEventListener('toggle', () => {
    try {
      sessionStorage.setItem(DETAILS_KEY, details.open ? 'open' : 'closed')
    } catch { /* not remembered */ }
  })

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
    const text = picked ? 'Click another building to switch.' : guide.open ? '' : 'Pick a building to unlock Plan, 3D, Panels and Garden.'
    mapHint.textContent = text
    mapHint.hidden = !text || panel.dataset.view !== 'map'
  }
  let listener: ((when: Date, sun: SunDirection, strip: string, place: { lat: number; lon: number }) => void) | undefined

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
    listener?.(when, sun, strip.style.background, { lat: la, lon: lo })
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
  // Walking, the controls hand the keys back to the walk once used.
  const giveKeysBack = (e: Event) => {
    if (panel.classList.contains('walking')) (e.target as HTMLElement).blur()
  }
  time.addEventListener('pointerup', giveKeysBack)
  time.addEventListener('change', giveKeysBack)
  play.addEventListener('click', giveKeysBack)
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
      building = b
      hasBuilding = b !== null
      if (b) renderBuilding(el, b)
      updateNote()
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
      dock.hidden = view !== '3d'
      if (view === 'map') updateMapHint()
      updateNote()
    },
    setBuildingPicked(isPicked) {
      picked = isPicked
      updateMapHint()
      for (const b of viewButtons) {
        if (b.dataset.view === 'map') continue
        b.disabled = !picked
        b.title = !picked
          ? 'Pick a building first'
          : b.dataset.view === 'plan' ? 'Draw your apartment on this building'
          : b.dataset.view === 'panels' ? 'Solar panels: where they would do best and what yours make'
          : b.dataset.view === 'garden' ? 'Click a spot to see what grows there, or find a place for a plant' : 'Sun and shadows in 3D'
      }
    },
    setNextStep(step) {
      $('planNext').textContent =
        step === 'outline' ? "Draw your apartment's outline, then place its windows."
        : step === 'windows' ? 'Now place windows on the outline.'
        : 'Windows placed.'
      $('planToThree').hidden = step !== 'see'
      nextButton.hidden = step === 'see'
      nextButton.textContent = step === 'outline' ? 'Draw your apartment' : 'Place the windows'
      // Walking needs windows; before that the Next prompt leads, and double-clicking the floor still works.
      walk.hidden = step !== 'see'
    },
    setExample(on) {
      exampleOn = on
      if (on) exampleGone = false
      updateNote()
    },
    setRoofHint(show) {
      $('gardenRoofHint').hidden = !show
    },
    setPlanActive(active) {
      $('aptShow').hidden = !active
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
    onSunMap(fn) {
      sunMapListener = fn
    },
    onMarkGuessed(fn) {
      guessedListener = fn
      fn(guessed.checked)
    },
    onEditHeight(fn) {
      editHeightListener = fn
    },
    setSunMap(on) {
      if (sunMap.checked === on) return
      sunMap.checked = on
      applySunMap()
    },
    toggleSunMap() {
      sunMap.checked = !sunMap.checked
      applySunMap()
    },
    setSunMapStatus(status) {
      legend.innerHTML = legendHtml(status)
    },
    onSuitability(fn) {
      suitListener = fn
    },
    setSuitability(on) {
      if (suit.checked === on) return
      suit.checked = on
      applySuit()
    },
    setSuitabilityStatus(status) {
      suitLegend.innerHTML = suitabilityLegendHtml(status)
    },
    setSuitabilityFrame(visible) {
      suitFrame.hidden = !visible || !suit.checked
    },
    onSuitabilityFrame(fn) {
      suitFrameListener = fn
    },
    setPanelList({ items, selected, total }) {
      const totalEl = $('panelTotals')
      totalEl.hidden = total === null
      totalEl.textContent = total ?? ''
      const rows = $('panelRows')
      rows.hidden = items.length === 0
      $('panelEmpty').hidden = items.length > 0
      $('panelLead').hidden = items.length > 0
      rows.replaceChildren(
        ...items.map((item) => {
          const li = document.createElement('li')
          const b = Object.assign(document.createElement('button'), { type: 'button' })
          b.dataset.id = item.id
          b.setAttribute('aria-pressed', String(item.id === selected))
          b.append(Object.assign(document.createElement('span'), { textContent: item.label }), Object.assign(document.createElement('span'), { textContent: item.detail }))
          li.append(b)
          return li
        }),
      )
    },
    onPanelPick(fn) {
      panelPickListener = fn
    },
    cardSlot: $('cardSlot'),
    gardenSlot: $('gardenSlot'),
    gardenFindSlot: $('gardenFindSlot'),
    gardenMonthSlot: $('gardenMonthSlot'),
    gardenSection: $('gardenSection'),
    dock,
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
    onChange(fn) {
      listener = fn
      refresh()
    },
  }
}

/** The sun map legend: one line of ramp from 0 h to 6 h+; the share of the day's daylight sits behind a disclosure. */
function legendHtml(status: SunMapStatus): string {
  if (status.kind === 'computing') {
    const pct = Math.round(status.progress * 100)
    return `<span class="legendHead" role="status">Computing the sun map\u2026 ${pct}%</span><div class="legendBar busy" style="--progress:${pct}%"></div>`
  }
  if (status.kind === 'error') return `<span class="legendHead" role="alert">${status.message}</span>`
  const { daylightMinutes, day } = status
  const label = dayLabel(day.getMonth(), day.getDate())
  if (daylightMinutes === 0) return `<span class="legendHead">No daylight on ${label}</span>`
  // Hours along the bar (6 h and more share the lightest colour) and, behind the disclosure, what each is of today's daylight.
  const hours = [0, 2, 4, 6]
  const share = (h: number) => (h * 60 <= daylightMinutes ? `${Math.round((h * 6000) / daylightMinutes)}%` : '\u2013')
  return (
    `<span class="legendHead" title="Click the floor to see the hours at a spot">Direct sun on ${label}</span>` +
    `<div class="legendLine"><span>0 h</span><div class="legendBar" style="background:${sunGradient()}"></div><span>6 h+</span></div>` +
    `<details class="legendMore"><summary>Share of daylight</summary>` +
    `<div class="legendTicks">${hours.map((h) => `<span>${h === 6 ? '6 h+' : `${h} h`}</span>`).join('')}</div>` +
    `<div class="legendTicks muted">${hours.map((h) => `<span>${share(h)}</span>`).join('')}</div>` +
    `<span class="legendHint">Percent of the day's ${duration(daylightMinutes)} of daylight. Click the floor to see the hours at a spot.</span></details>`
  )
}

/** The suitability legend: the ramp in kWh a year per kW of panels, and what the colours assume. */
function suitabilityLegendHtml(status: SuitabilityStatus): string {
  if (status.kind === 'computing') {
    const pct = Math.round(status.progress * 100)
    const head = status.updating ? 'Updating the panel map' : 'Computing the panel map'
    return `<span class="legendHead" role="status">${head}\u2026 ${pct}%</span><div class="legendBar busy" style="--progress:${pct}%"></div>`
  }
  if (status.kind === 'error') return `<span class="legendHead" role="alert">${status.message}</span>`
  const at = (t: number) => (((t - status.min) / (status.max - status.min)) * 100).toFixed(1)
  const tick = (t: number) => `<span style="left:${at(t)}%">${t.toLocaleString('en')}</span>`
  return (
    `<span class="legendHead">Energy a year for each kW of panels, ${status.weather ? 'with local weather' : 'clear sky (no weather data)'}</span>` +
    `<div class="legendBar" style="background:${sunGradient()}"></div>` +
    `<div class="legendTicks scaled">${status.ticks.map(tick).join('')}</div>` +
    `<span class="legendUnit">${rangeText(status.observed)}</span>` +
    `<span class="legendHint">${status.count.toLocaleString('en')} spots on the facade (vertical), roof and ground (30\u00b0 stands facing the sun). Colours span the range found here. The whole building is shown, floors above the apartment included. Click a spot for details.</span>`
  )
}

/** The building's identity on one line (and its name or address above it); the OSM text is set as text, not HTML. */
function renderBuilding(el: HTMLElement, b: Building) {
  const line = buildingLine(b)
  const row = document.createElement('div')
  row.className = 'buildLine'
  const id = line.href ? Object.assign(document.createElement('a'), { href: line.href, target: '_blank', rel: 'noreferrer', textContent: line.label, className: 'osmLink', title: `Open ${line.osmId} in OpenStreetMap`, ariaLabel: `${line.label}: ${line.osmId}, opens in a new tab` }) : document.createTextNode(line.label)
  const facts = Object.assign(document.createElement('span'), { textContent: ` \u00b7 ${line.facts.join(' \u00b7 ')}`, title: line.heightNote })
  row.append(id, facts)
  const extra: HTMLElement[] = []
  // Where the height came from, when it is a guess or yours; the button is the way to change any height without a neighbour to click.
  const note = Object.assign(document.createElement('span'), { className: 'heightNote' })
  if (line.source) note.append(Object.assign(document.createElement('span'), { className: line.source.includes('guessed') || line.source.includes('estimated') ? 'guess' : '', textContent: line.source }), ' ')
  note.append(Object.assign(document.createElement('button'), { type: 'button', className: 'link editHeight', textContent: 'Edit height', title: 'Set the height of this building in floors or metres (right-click any building in 3D to do the same)' }))
  extra.push(note)
  if (b.capped) extra.push(Object.assign(document.createElement('span'), { className: 'hint', textContent: 'Stopped at a large selection; shift-click to trim it.' }))
  // The Map view says how to grow the selection; 3D and Plan have the dismissible switching hint instead.
  const parts = b.members?.length ?? 1
  extra.push(Object.assign(document.createElement('span'), { className: 'hint mapOnly', textContent: parts > 1 ? 'Shift-click in 3D to add or remove parts.' : 'Shift-click a neighbour in 3D to add it.' }))
  el.replaceChildren(...(line.title ? [Object.assign(document.createElement('strong'), { textContent: line.title })] : []), row, ...extra)
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
