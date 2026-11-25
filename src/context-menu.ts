import { t } from './i18n'
import { freeBand, menuCorner } from './popover-place'

export interface MenuEntry {
  label: string
  run?: () => void
  /** A sub-list: it replaces the list in the same box, under a Back item (no fly-out to fall off a phone screen). */
  items?: MenuEntry[]
}

export interface ContextMenu {
  /** Shows the groups (separated by a line) at the screen point; an empty list shows nothing. */
  open(groups: MenuEntry[][], at: { x: number; y: number }): void
  close(): void
  readonly isOpen: boolean
}

const EDGE = 8

/**
 * A small menu at a screen point. Arrow keys, Home and End move, Enter or Space picks, Right opens a sub-list and Left
 * goes back from it, Esc and Tab close it. A press outside, the wheel, a scroll or a resize close it too.
 */
export function createContextMenu(container: HTMLElement): ContextMenu {
  const box = document.createElement('div')
  box.className = 'ctxMenu'
  box.hidden = true
  box.setAttribute('role', 'menu')
  box.setAttribute('aria-label', t('menu.aria'))
  container.appendChild(box)
  let root: MenuEntry[][] = []
  let at = { x: 0, y: 0 }
  /** Where the keyboard focus was before the menu took it: it goes back there when the menu closes. */
  let returnTo: HTMLElement | null = null

  const items = () => [...box.querySelectorAll<HTMLButtonElement>('[role=menuitem]')]
  function focusAt(index: number) {
    const list = items()
    list[(index + list.length) % list.length]?.focus()
  }

  function show(groups: MenuEntry[][], back: boolean) {
    box.replaceChildren()
    const backEntry: MenuEntry = { label: t('menu.back') }
    const entries = back ? [[backEntry], ...groups] : groups
    entries.forEach((group, i) => {
      if (i > 0) box.appendChild(Object.assign(document.createElement('div'), { className: 'ctxSep', role: 'separator' }))
      for (const entry of group) {
        const b = document.createElement('button')
        b.type = 'button'
        b.tabIndex = -1
        b.setAttribute('role', 'menuitem')
        b.textContent = entry.label
        if (entry === backEntry) b.classList.add('ctxBack')
        if (entry.items) {
          b.setAttribute('aria-haspopup', 'menu')
          b.classList.add('ctxSub')
        }
        b.addEventListener('click', () => {
          if (entry.items) return show([entry.items], true)
          if (entry === backEntry) return show(root, false)
          close()
          entry.run?.()
        })
        box.appendChild(b)
      }
    })
    box.hidden = false
    box.style.left = box.style.top = '0px' // measured at the corner, where nothing squeezes it
    const { width, height } = box.getBoundingClientRect()
    const band = freeBand()
    box.style.left = `${menuCorner(at.x, width, EDGE, window.innerWidth - EDGE)}px`
    box.style.top = `${menuCorner(at.y, height, band.minTop, band.maxBottom)}px`
    focusAt(0)
  }

  function close() {
    if (box.hidden) return
    const hadFocus = box.contains(document.activeElement)
    box.hidden = true
    box.replaceChildren()
    if (hadFocus) returnTo?.focus({ preventScroll: true })
  }

  box.addEventListener('keydown', (e) => {
    const list = items()
    const now = list.indexOf(document.activeElement as HTMLButtonElement)
    const sub = list[0]?.classList.contains('ctxBack')
    if (e.key === 'ArrowDown') focusAt(now + 1)
    else if (e.key === 'ArrowUp') focusAt(now - 1)
    else if (e.key === 'Home') focusAt(0)
    else if (e.key === 'End') focusAt(-1)
    else if (e.key === 'ArrowRight' && list[now]?.classList.contains('ctxSub')) list[now].click()
    else if (e.key === 'ArrowLeft' && sub) show(root, false)
    else if (e.key === 'Escape' || e.key === 'Tab') close()
    else return e.stopPropagation() // Enter and Space reach the button; other keys stay away from the scene and the shortcuts
    e.preventDefault()
    e.stopPropagation()
  })
  // A mouse over an item marks it, as in a native menu.
  box.addEventListener('pointermove', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[role=menuitem]')
    if (b && document.activeElement !== b) b.focus({ preventScroll: true })
  })
  // The scene is under this box: its own presses are not for the scene.
  for (const type of ['pointerdown', 'click', 'dblclick', 'contextmenu'] as const) box.addEventListener(type, (e) => e.stopPropagation())
  box.addEventListener('contextmenu', (e) => e.preventDefault())
  const outside = (e: Event) => !box.contains(e.target as Node) && close()
  document.addEventListener('pointerdown', outside, true)
  document.addEventListener('wheel', outside, { capture: true, passive: true })
  document.addEventListener('scroll', outside, true)
  window.addEventListener('resize', close)
  window.addEventListener('blur', close)

  return {
    open(groups, point) {
      const shown = groups.filter((g) => g.length > 0)
      if (!shown.length) return close()
      if (box.hidden) returnTo = document.activeElement as HTMLElement | null
      root = shown
      at = point
      show(root, false)
    },
    close,
    get isOpen() {
      return !box.hidden
    },
  }
}
