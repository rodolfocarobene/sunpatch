const GAP = 18
const WIDTH = 284

export interface SuitabilityPopover {
  /** Shows the answer for a spot; it stays hidden until the scene reports where the spot is on screen. */
  show(text: { title: string; figure: string; detail: string }): void
  /** Follows the marked quad on screen; hidden while it is out of view. */
  moveTo(at: { x: number; y: number; visible: boolean } | null): void
  hide(): void
  readonly open: boolean
}

/**
 * A small box at the chosen quad of the suitability map: what the surface is, its yearly energy for each kW of panels, and a button
 * that places a panel there. Closes on its button, or when the caller hides it (a click elsewhere, Esc).
 */
export function createSuitabilityPopover(container: HTMLElement, handlers: { onClose(): void; onPlace(): void }): SuitabilityPopover {
  const box = document.createElement('div')
  box.id = 'suitPopover'
  box.hidden = true
  box.setAttribute('role', 'dialog')
  box.setAttribute('aria-label', 'Panel suitability at this spot')
  box.innerHTML = `
    <button type="button" class="spotClose" aria-label="Close" title="Close (Esc)">
      <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
    </button>
    <strong class="spotHead"></strong>
    <span class="suitFigure"></span>
    <span class="spotDetail"></span>
    <button type="button" class="primary suitPlace">Place a panel here</button>`
  container.appendChild(box)
  const title = box.querySelector('.spotHead')!
  const figure = box.querySelector('.suitFigure')!
  const detail = box.querySelector('.spotDetail')!
  let isOpen = false

  function hide() {
    isOpen = false
    box.hidden = true
  }
  box.querySelector('.spotClose')!.addEventListener('click', () => {
    hide()
    handlers.onClose()
  })
  box.querySelector('.suitPlace')!.addEventListener('click', () => handlers.onPlace())
  // Clicks inside the box are not clicks on the scene.
  for (const type of ['pointerdown', 'click', 'dblclick'] as const) box.addEventListener(type, (e) => e.stopPropagation())

  return {
    show(text) {
      title.textContent = text.title
      figure.textContent = text.figure
      detail.textContent = text.detail
      isOpen = true
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
    hide,
    get open() {
      return isOpen
    },
  }
}
