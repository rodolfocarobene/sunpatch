import { DAY_MAX } from './daylight'
import { clock, duration, type SpotStats } from './sunmap'

/** The text of the popover: the answer first ("3 h 10 min of direct sun"), then the share and each interval. */
export function spotSentence(stats: SpotStats): { headline: string; share: string; intervals: string[] } {
  if (stats.minutes === 0) return { headline: 'No direct sun here', share: 'on this day', intervals: [] }
  return {
    headline: `${duration(stats.minutes)} of direct sun`,
    share: `${Math.round(stats.share * 100)}% of daylight`,
    intervals: stats.intervals.map((i) => `${clock(i.from)}–${clock(i.to)}`),
  }
}

export interface SunMapPopover {
  /** Shows the answer for a spot. `strip` is the CSS background of the day strip (the time slider's). */
  show(stats: SpotStats, strip: string, minutesNow: number): void
  /** Follows the marked point on screen; hidden while it is out of view. */
  moveTo(at: { x: number; y: number; visible: boolean } | null): void
  /** The time slider moved: the "now" tick follows. */
  setNow(minutes: number): void
  hide(): void
  readonly open: boolean
}

const GAP = 18
const WIDTH = 252

/**
 * A small box at the clicked floor point, with the same day strip as the time slider and the sunny intervals
 * drawn on it. Closes on its button, or when the caller hides it (a click elsewhere, Esc).
 */
export function createSunMapPopover(container: HTMLElement, onClose: () => void): SunMapPopover {
  const box = document.createElement('div')
  box.id = 'spotPopover'
  box.hidden = true
  box.setAttribute('role', 'dialog')
  box.setAttribute('aria-label', 'Direct sun at this spot')
  box.innerHTML = `
    <button type="button" class="spotClose" aria-label="Close" title="Close (Esc)">
      <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
    </button>
    <strong class="spotHead"></strong>
    <span class="spotDetail"></span>
    <div class="spotTrack" aria-hidden="true"><div class="dayStrip"></div><div class="spotSun"></div><div class="spotNow"></div></div>
    <div class="spotAxis" aria-hidden="true"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>`
  container.appendChild(box)
  const head = box.querySelector('.spotHead')!
  const detail = box.querySelector('.spotDetail')!
  const strip = box.querySelector<HTMLElement>('.dayStrip')!
  const sun = box.querySelector<HTMLElement>('.spotSun')!
  const now = box.querySelector<HTMLElement>('.spotNow')!
  let isOpen = false

  const close = () => {
    if (!isOpen) return
    hide()
    onClose()
  }
  box.querySelector('.spotClose')!.addEventListener('click', close)
  // Clicks inside the box are not clicks on the scene.
  for (const type of ['pointerdown', 'click', 'dblclick'] as const) box.addEventListener(type, (e) => e.stopPropagation())

  function hide() {
    isOpen = false
    box.hidden = true
  }
  const frac = (m: number) => `${(Math.min(1, Math.max(0, m / DAY_MAX)) * 100).toFixed(2)}%`
  const place = (m: number) => {
    now.style.left = frac(m)
  }

  return {
    show(stats, background, minutesNow) {
      const { headline, share, intervals } = spotSentence(stats)
      head.textContent = headline
      // Each interval stays on one line; they wrap between each other.
      detail.replaceChildren(
        share,
        ...intervals.flatMap((t, k) => {
          const span = document.createElement('span')
          span.textContent = t + (k < intervals.length - 1 ? ',' : '')
          return [k === 0 ? ' · ' : ' ', span]
        }),
      )
      strip.style.background = background
      sun.replaceChildren(
        ...stats.intervals.map((i) => {
          const bar = document.createElement('i')
          bar.style.left = frac(i.from)
          bar.style.width = `${((Math.min(DAY_MAX, i.to) - i.from) / DAY_MAX) * 100}%`
          bar.title = `${clock(i.from)}–${clock(i.to)}`
          return bar
        }),
      )
      place(minutesNow)
      isOpen = true
      // Hidden until the scene reports where the point is on screen (next frame).
      box.style.visibility = 'hidden'
      box.hidden = false
    },
    moveTo(at) {
      if (!isOpen) return
      if (!at || !at.visible) {
        box.style.visibility = 'hidden'
        return
      }
      box.style.visibility = ''
      const height = box.offsetHeight
      const below = at.y - height - GAP < 8
      const left = Math.min(window.innerWidth - WIDTH / 2 - 8, Math.max(WIDTH / 2 + 8, at.x))
      box.style.left = `${left}px`
      box.style.top = `${below ? at.y + GAP : at.y - height - GAP}px`
    },
    setNow: place,
    hide,
    get open() {
      return isOpen
    },
  }
}
