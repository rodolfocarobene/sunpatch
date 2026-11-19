import { getLang, t, type Lang } from './i18n'
import { createLofiPlayer, type TuneInfo } from './lofi-music'

const MODE_KEY = 'sunpatch.lofi'
const VOLUME_KEY = 'sunpatch.lofiVolume'
const DEFAULT_VOLUME = 0.6

const KEY_NAMES: Record<Lang, string[]> = {
  en: ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'],
  it: ['Do', 'Re♭', 'Re', 'Mi♭', 'Mi', 'Fa', 'Sol♭', 'Sol', 'La♭', 'La', 'Si♭', 'Si'],
}
const NEXT_ICON =
  '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2 2l6 4-6 4zM10 2v8" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>'

/** "Eb major · 74 bpm" in the current language. */
export const tuneLine = ({ key, bpm }: TuneInfo): string => t('lofi.tune', { key: KEY_NAMES[getLang()][key], bpm })

/** A stored volume in 0..1, else the default. */
export function parseVolume(raw: string | null): number {
  const v = raw === null || raw.trim() === '' ? NaN : Number(raw)
  return v >= 0 && v <= 1 ? v : DEFAULT_VOLUME
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch { /* storage blocked: not remembered */ }
}

/**
 * Lofi mode: a toggle for the panel header and a slim mini-player row for under it. The mode is remembered, the music never
 * starts by itself (browsers block audio without a click): after a reload the player is back, paused.
 */
export function createLofi(): { toggle: HTMLButtonElement; bar: HTMLElement } {
  const player = createLofiPlayer()
  let on = false
  let volume = DEFAULT_VOLUME
  try {
    on = localStorage.getItem(MODE_KEY) === 'on'
    volume = parseVolume(localStorage.getItem(VOLUME_KEY))
  } catch { /* storage blocked: defaults */ }
  player.setVolume(volume)

  const toggle = Object.assign(document.createElement('button'), { type: 'button', id: 'lofiToggle', className: 'lofiToggle', textContent: t('lofi.toggle'), title: t('lofi.toggleTitle') })
  const bar = document.createElement('div')
  bar.id = 'lofiBar'
  bar.setAttribute('role', 'group')
  bar.setAttribute('aria-label', t('lofi.player'))
  bar.innerHTML = `
    <div class="lofiRow">
      <button id="lofiPlay" class="lofiPlay" type="button"></button>
      <button id="lofiNext" class="lofiNext" type="button" title="${t('lofi.next')}" aria-label="${t('lofi.next')}">${NEXT_ICON}</button>
      <input id="lofiVolume" type="range" min="0" max="1" step="0.01" value="${volume}" aria-label="${t('lofi.volume')}" title="${t('lofi.volume')}">
    </div>
    <div id="lofiTune" class="lofiTune"></div>`
  const playBtn = bar.querySelector<HTMLButtonElement>('#lofiPlay')!
  const nextBtn = bar.querySelector<HTMLButtonElement>('#lofiNext')!
  const volumeInput = bar.querySelector<HTMLInputElement>('#lofiVolume')!
  const tuneEl = bar.querySelector<HTMLElement>('#lofiTune')!

  const showPlay = () => {
    playBtn.textContent = player.isPlaying() ? t('lofi.pause') : t('lofi.play')
  }
  const apply = () => {
    if (on) document.documentElement.dataset.lofi = 'on'
    else delete document.documentElement.dataset.lofi
    toggle.setAttribute('aria-pressed', String(on))
    bar.hidden = !on
    showPlay()
  }

  player.onTune((info) => { tuneEl.textContent = tuneLine(info) })
  toggle.addEventListener('click', () => {
    on = !on
    if (!on) player.pause()
    store(MODE_KEY, on ? 'on' : 'off')
    apply()
  })
  playBtn.addEventListener('click', async () => {
    if (player.isPlaying()) player.pause()
    else {
      try {
        await player.play()
      } catch { /* no audio available: stay paused */ }
    }
    showPlay()
  })
  nextBtn.addEventListener('click', () => player.next())
  volumeInput.addEventListener('input', () => {
    volume = parseVolume(volumeInput.value)
    player.setVolume(volume)
    store(VOLUME_KEY, String(volume))
  })
  apply()
  return { toggle, bar }
}
