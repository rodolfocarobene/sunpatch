import { t } from './i18n'
import type { KeepMode } from './height-store'

export interface KeepChip {
  /** Asks "Keep your height changes ... for 30 days?"; stays until one of the two buttons is pressed. */
  ask(): void
  hide(): void
}

/** The one-time question about keeping height changes, in the corner of the 3D view under the status chip (same look, no animation). */
export function createKeepChip(container: HTMLElement, onChoose: (mode: KeepMode) => void): KeepChip {
  const el = document.createElement('div')
  el.id = 'keepChip'
  el.hidden = true
  el.setAttribute('role', 'status')
  const text = document.createElement('span')
  text.textContent = t('shell.heightsAsk')
  const button = (label: string, mode: KeepMode) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = label
    b.addEventListener('click', () => {
      el.hidden = true
      onChoose(mode)
    })
    return b
  }
  el.append(text, button(t('shell.heightsKeepYes'), 'keep'), button(t('shell.heightsKeepNo'), 'session'))
  container.appendChild(el)
  return {
    ask: () => (el.hidden = false),
    hide: () => (el.hidden = true),
  }
}
