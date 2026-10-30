import SunCalc from 'suncalc'
import { createLangSwitch } from './lang-switch'
import { fmt1Fixed, fmtNumber, fmtTime, t, type Key } from './i18n'
import type { Building } from './osm'
import type { SunDirection } from './sun'
import { activePreset, dateValue, dayLabel, daylight, snapMinutes, nextPlayMinute, presetDates, startMinutes, stripGradient, STEP, DAY_MAX, type Daylight } from './daylight'
import { compassName, sunDirection } from './sun'
import type { NextStep } from './next-step'
import { ACCURACY_URL } from './panel-card'
import { duration, sunGradient } from './sunmap'
import { rangeText } from './suitability'
import { buildingLine } from './building-line'
import { NEIGHBORHOODS, parseNeighborhood, type NeighborhoodId } from './neighborhood'

const GUIDE_KEY = 'sunpatch.guide'
const SWITCH_HINT_KEY = 'sunpatch.switchHint'
const DETAILS_KEY = 'sunpatch.details'
const NEIGHBORHOOD_KEY = 'sunpatch.neighborhood'
const CLOSE_ICON =
  '<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>'

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
  /** The neighbourhood size (kept in localStorage): hear about it now and on every change. */
  onNeighborhood(listener: (size: NeighborhoodId) => void): void
  /** The line under the size menu ("214 buildings within 350 m"); null clears it. */
  setNeighborhoodLine(text: string | null): void
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
  /** The "Frame the view" button over the scene (3D, Panels, Garden): hear its press. */
  onReframe(listener: () => void): void
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
    <div id="panelTop">
      <a id="about" href="../" title="${t('shell.aboutTitle')}">&larr; ${t('shell.back')}</a>
    </div>
    <nav id="views">
      <button type="button" data-view="map">${t('shell.tabMap')}</button>
      <button type="button" data-view="plan" disabled title="${t('shell.pickFirst')}">${t('shell.tabPlan')}</button>
      <button type="button" data-view="3d" disabled title="${t('shell.pickFirst')}">${t('shell.tab3d')}</button>
      <button type="button" data-view="panels" disabled title="${t('shell.pickFirst')}">${t('shell.tabPanels')}</button>
      <button type="button" data-view="garden" disabled title="${t('shell.pickFirst')}">${t('shell.tabGarden')}</button>
    </nav>
    <section data-views="map">
      <h2>${t('shell.findBuilding')}</h2>
      <div id="searchSlot"></div>
    </section>
    <div id="building" hidden></div>
    <div data-views="map" id="firstRun">
      <details id="guide" open>
        <summary>${t('shell.guide')}</summary>
        <ol>
          <li aria-current="step"><strong>${t('shell.guide1')}</strong><span>${t('shell.guide1Detail')}</span></li>
          <li>${t('shell.guide2')}</li>
          <li>${t('shell.guide3')}</li>
        </ol>
      </details>
      <a id="exampleLink" href="?example=milan">${t('shell.example')}</a>
    </div>
    <p class="hint" id="mapHint" data-views="map" hidden></p>
    <div data-views="plan 3d" id="notes">
      <div id="note" class="noteBox" hidden>
        <div><p id="noteExample"></p><p id="noteHint"></p></div>
        <button id="noteClose" class="closeX" type="button" aria-label="${t('shell.noteClose')}" title="${t('shell.noteCloseTitle')}">${CLOSE_ICON}</button>
      </div>
    </div>
    <p class="hint" data-views="plan"><span id="planNext"></span> <button id="planToThree" class="link next" type="button" hidden>${t('shell.see3d')}</button></p>
    <section data-views="3d">
      <button id="nextStep" class="link next" type="button"></button>
      <div id="aptTools">
        <button id="walk" class="primary" type="button" hidden title="${t('shell.walkTitle')}">${t('shell.walk')}</button>
        <div class="field">
          <h3 class="groupHead">${t('shell.show')}</h3>
          <div id="aptShow" hidden>
            <label class="row"><input id="cutaway" type="checkbox" checked> ${t('shell.cutaway')} <kbd class="walkKey">H</kbd></label>
            <label class="row" title="${t('shell.sunMapTitle')}"><input id="sunMap" type="checkbox"> ${t('shell.sunMap')} <kbd class="walkKey">M</kbd></label>
            <div id="sunMapLegend" hidden></div>
          </div>
        </div>
      </div>
      <details id="location">
        <summary>${t('shell.details')}</summary>
        <div id="guessedBox">
          <label class="row" title="${t('shell.guessedTitle')}"><input id="guessed" type="checkbox" checked> ${t('shell.guessed')}</label>
          <p id="guessedLegend" class="legendNote"><i class="hatchKey" aria-hidden="true"></i>${t('shell.guessedLegend')}</p>
        </div>
        <div id="hoodBox">
          <label class="hoodRow" title="${t('shell.hoodTitle')}">${t('shell.hood')}
            <select id="hood">${NEIGHBORHOODS.map((n) => `<option value="${n.id}">${t(n.label)} (${n.radiusM} m)</option>`).join('')}</select></label>
          <p id="hoodLine" class="legendNote" role="status"></p>
        </div>
        <div class="coords">
          <label>${t('shell.lat')} <input id="lat" type="number" step="0.0001" min="-90" max="90" value="${MILAN.lat}"></label>
          <label>${t('shell.lon')} <input id="lon" type="number" step="0.0001" min="-180" max="180" value="${MILAN.lon}"></label>
          <p class="note">${t('shell.directOnly')} <a href="${ACCURACY_URL}" target="_blank" rel="noreferrer">${t('shell.accuracy')}</a></p>
        </div>
      </details>
    </section>
    <section data-views="panels">
      <p id="panelLead" class="panelLead">${t('shell.panelLead')}</p>
      <div class="field">
        <label class="row" title="${t('shell.suitTitle')}"><input id="suit" type="checkbox"> ${t('shell.suit')}</label>
        <div id="suitLegend" hidden></div>
      </div>
      <div id="panelList">
        <p id="panelTotals" class="hint" hidden></p>
        <ul id="panelRows" hidden></ul>
        <p id="panelEmpty" class="hint">${t('shell.panelEmptyBefore')}<button id="emptyToPlan" class="link" type="button">${t('shell.tabPlan')}</button>${t('shell.panelEmptyAfter')}</p>
      </div>
      <div id="cardSlot"></div>
    </section>
    <section data-views="garden" id="gardenSection">
      <div id="gardenSlot"></div>
      <div id="gardenMonthSlot"></div>
      <div class="field findGroup">
        <h3 class="groupHead">${t('shell.gardenFind')}</h3>
        <div id="gardenFindSlot"></div>
      </div>
      <div class="field">
        <label class="row" title="${t('shell.gardenCutawayTitle')}"><input id="gardenCutaway" type="checkbox" checked> ${t('shell.cutaway')}</label>
        <p id="gardenRoofHint" class="cardNote small" hidden>${t('shell.gardenRoofHint')}</p>
      </div>
    </section>`
  panel.querySelector('#panelTop')!.append(createLangSwitch())
  document.body.appendChild(panel)
  // One docked bar for date and time, shared by the 3D view and walk mode (the walk key hints stack above it).
  const dock = document.createElement('div')
  dock.id = 'dock'
  dock.hidden = true
  dock.innerHTML = `
    <div id="timeBar" role="group" aria-label="${t('sun.dock')}">
      <div id="sunSummary"></div>
      <div class="barRow">
        <div id="presets" role="group" aria-label="${t('sun.presets')}"></div>
        <input id="date" type="date" aria-label="${t('sun.date')}" value="${dateValue(now)}">
        <button id="play" type="button" title="${t('sun.playTitle')}">${t('sun.play')}</button>
      </div>
      <div class="barRow">
        <div class="timeTrack">
          <div id="dayStrip" class="dayStrip" aria-hidden="true"></div>
          <input id="time" class="timeRange" type="range" min="0" max="${DAY_MAX}" step="${STEP}" aria-label="${t('sun.time')}" value="${startMinutes(now, MILAN.lat, MILAN.lon)}">
        </div>
        <span id="timeLabel" title="${t('sun.tzTitle')}"></span>
      </div>
    </div>`
  document.body.appendChild(dock)
  // One way back to a good view in every scene view, in the same corner: it frames what the view is about.
  const reframe = document.createElement('button')
  reframe.id = 'reframe'
  reframe.type = 'button'
  reframe.hidden = true
  reframe.textContent = t('shell.reframe')
  reframe.title = t('shell.reframeTitle')
  let reframeListener: (() => void) | undefined
  reframe.addEventListener('click', () => reframeListener?.())
  document.body.appendChild(reframe)

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
  const hood = $<HTMLSelectElement>('hood')
  let hoodListener: ((size: NeighborhoodId) => void) | undefined
  try {
    hood.value = parseNeighborhood(localStorage.getItem(NEIGHBORHOOD_KEY))
  } catch { /* storage blocked: the default */ }
  hood.addEventListener('change', () => {
    const size = parseNeighborhood(hood.value)
    try {
      localStorage.setItem(NEIGHBORHOOD_KEY, size)
    } catch { /* not remembered */ }
    hoodListener?.(size)
  })
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
  let suitListener: ((on: boolean) => void) | undefined
  const applySuit = () => {
    suitLegend.hidden = !suit.checked
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
    $('noteExample').textContent = t('shell.noteExample')
    $('noteHint').hidden = !hint
    $('noteHint').textContent =
      view === 'plan' ? t('shell.notePlan') : t(parts ? 'shell.note3dParts' : 'shell.note3d')
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
    const text = picked ? t('shell.mapSwitch') : guide.open ? '' : t('shell.mapUnlock')
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
      summary.textContent = t('sun.invalid')
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
    const rise = fmtTime(times.sunrise)
    const set = fmtTime(times.sunset)
    strip.title = day.info.polar === 'day' ? t('sun.upAllDay') : day.info.polar === 'night' ? t('sun.downAllDay') : t('sun.daylight', { rise, set })
    summary.title = t('sun.angles', { az: fmt1Fixed(sun.azimuthDeg), alt: fmt1Fixed(sun.altitudeDeg) })
    // Two deliberate lines instead of one that wraps at an arbitrary word.
    const { where, height } = sunParts(sun)
    summary.innerHTML =
      `<strong>${where}</strong>` +
      (height ? `<span>${height}</span>` : '') +
      `<span>${rise && set ? t('sun.riseSet', { rise, set }) : t('sun.noRiseSet')}</span>`
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
    play.textContent = t('sun.pause')
    playStep()
    timer = window.setInterval(playStep, 50)
  })
  function stop() {
    window.clearInterval(timer)
    timer = undefined
    play.textContent = t('sun.play')
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
      reframe.hidden = view !== '3d' && view !== 'panels' && view !== 'garden'
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
          ? t('shell.pickFirst')
          : b.dataset.view === 'plan' ? t('shell.tabPlanTitle')
          : b.dataset.view === 'panels' ? t('shell.tabPanelsTitle')
          : b.dataset.view === 'garden' ? t('shell.tabGardenTitle') : t('shell.tab3dTitle')
      }
    },
    setNextStep(step) {
      $('planNext').textContent =
        step === 'outline' ? t('shell.planOutline')
        : step === 'windows' ? t('shell.planWindows')
        : t('shell.planDone')
      $('planToThree').hidden = step !== 'see'
      nextButton.hidden = step === 'see'
      nextButton.textContent = step === 'outline' ? t('shell.nextOutline') : t('shell.nextWindows')
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
    onNeighborhood(fn) {
      hoodListener = fn
      fn(parseNeighborhood(hood.value))
    },
    setNeighborhoodLine(text) {
      $('hoodLine').textContent = text ?? ''
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
    onReframe(fn) {
      reframeListener = fn
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
    return `<span class="legendHead" role="status">${t('sun.mapComputing', { pct })}</span><div class="legendBar busy" style="--progress:${pct}%"></div>`
  }
  if (status.kind === 'error') return `<span class="legendHead" role="alert">${status.message}</span>`
  const { daylightMinutes, day } = status
  const label = dayLabel(day.getMonth(), day.getDate())
  if (daylightMinutes === 0) return `<span class="legendHead">${t('sun.mapNoDaylight', { day: label })}</span>`
  // Hours along the bar (6 h and more share the lightest colour) and, behind the disclosure, what each is of today's daylight.
  const hours = [0, 2, 4, 6]
  const share = (h: number) => (h * 60 <= daylightMinutes ? `${Math.round((h * 6000) / daylightMinutes)}%` : '\u2013')
  return (
    `<span class="legendHead" title="${t('sun.mapTitle')}">${t('sun.mapHead', { day: label })}</span>` +
    `<div class="legendLine"><span>0 h</span><div class="legendBar" style="background:${sunGradient()}"></div><span>6 h+</span></div>` +
    `<details class="legendMore"><summary>${t('sun.mapShare')}</summary>` +
    `<div class="legendTicks">${hours.map((h) => `<span>${h === 6 ? '6 h+' : `${h} h`}</span>`).join('')}</div>` +
    `<div class="legendTicks muted">${hours.map((h) => `<span>${share(h)}</span>`).join('')}</div>` +
    `<span class="legendHint">${t('sun.mapShareHint', { duration: duration(daylightMinutes) })}</span></details>`
  )
}

/** The suitability legend: the ramp in kWh a year per kW of panels, and what the colours assume. */
function suitabilityLegendHtml(status: SuitabilityStatus): string {
  if (status.kind === 'computing') {
    const pct = Math.round(status.progress * 100)
    const head = t(status.updating ? 'sun.suitUpdating' : 'sun.suitComputing')
    return `<span class="legendHead" role="status">${head}\u2026 ${pct}%</span><div class="legendBar busy" style="--progress:${pct}%"></div>`
  }
  if (status.kind === 'error') return `<span class="legendHead" role="alert">${status.message}</span>`
  const at = (v: number) => (((v - status.min) / (status.max - status.min)) * 100).toFixed(1)
  const tick = (v: number) => `<span style="left:${at(v)}%">${fmtNumber(v)}</span>`
  return (
    `<span class="legendHead">${t(status.weather ? 'sun.suitHeadWeather' : 'sun.suitHeadClear')}</span>` +
    `<div class="legendBar" style="background:${sunGradient()}"></div>` +
    `<div class="legendTicks scaled">${status.ticks.map(tick).join('')}</div>` +
    `<span class="legendUnit">${rangeText(status.observed)}</span>` +
    `<span class="legendHint">${t('sun.suitHint', { n: status.count })}</span>`
  )
}

/** The building's identity on one line (and its name or address above it); the OSM text is set as text, not HTML. */
function renderBuilding(el: HTMLElement, b: Building) {
  const line = buildingLine(b)
  const row = document.createElement('div')
  row.className = 'buildLine'
  const id = line.href ? Object.assign(document.createElement('a'), { href: line.href, target: '_blank', rel: 'noreferrer', textContent: line.label, className: 'osmLink', title: t('bld.open', { id: line.osmId ?? '' }), ariaLabel: t('bld.openAria', { label: line.label, id: line.osmId ?? '' }) }) : document.createTextNode(line.label)
  const facts = Object.assign(document.createElement('span'), { textContent: ` \u00b7 ${line.facts.join(' \u00b7 ')}`, title: line.heightNote })
  row.append(id, facts)
  const extra: HTMLElement[] = []
  // Where the height came from, when it is a guess or yours; the button is the way to change any height without a neighbour to click.
  const note = Object.assign(document.createElement('span'), { className: 'heightNote' })
  if (line.source) note.append(Object.assign(document.createElement('span'), { className: line.guess ? 'guess' : '', textContent: line.source }), ' ')
  note.append(Object.assign(document.createElement('button'), { type: 'button', className: 'link editHeight', textContent: t('bld.editHeight'), title: t('bld.editHeightTitle') }))
  extra.push(note)
  if (b.capped) extra.push(Object.assign(document.createElement('span'), { className: 'hint', textContent: t('bld.capped') }))
  // The Map view says how to grow the selection; 3D and Plan have the dismissible switching hint instead.
  const parts = b.members?.length ?? 1
  extra.push(Object.assign(document.createElement('span'), { className: 'hint mapOnly', textContent: t(parts > 1 ? 'bld.addParts' : 'bld.addNeighbour') }))
  el.replaceChildren(...(line.title ? [Object.assign(document.createElement('strong'), { textContent: line.title })] : []), row, ...extra)
}

function formatMinutes(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}

const WORDS: Record<string, Key> = { N: 'sun.dirN', E: 'sun.dirE', S: 'sun.dirS', W: 'sun.dirW' }

/** The two halves of the sun sentence: where it is, and how high (empty while it is down). */
export function sunParts(sun: SunDirection): { where: string; height: string } {
  if (sun.altitudeDeg <= 0) return { where: t('sun.below'), height: '' }
  const dir = [...compassName(sun.azimuthDeg)].map((c) => t(WORDS[c])).join('-')
  return { where: t('sun.where', { dir }), height: t('sun.above', { alt: sun.altitudeDeg.toFixed(0) }) }
}
