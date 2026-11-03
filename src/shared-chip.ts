import { t } from './i18n'

export interface SharedChip {
  /** "Viewing a shared plan" with a Save-as-mine button; stays until dismissed, saved or another building is picked. */
  showShared(onSave: () => void, onStartOwn: () => void): void
  /** A short notice (a damaged link), then it hides itself. */
  notice(text: string): void
  hide(): void
}

const NOTICE_MS = 7000

/** The quiet bar for share links, visible in every tab (the status chip lives in the 3D view only). */
export function createSharedChip(container: HTMLElement): SharedChip {
  const el = document.createElement('div')
  el.id = 'sharedChip'
  el.hidden = true
  el.setAttribute('role', 'status')
  const text = document.createElement('span')
  const save = document.createElement('button')
  save.type = 'button'
  save.textContent = t('shell.sharedSave')
  const own = document.createElement('button')
  own.type = 'button'
  own.textContent = t('shell.sharedOwn')
  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'closeX'
  close.textContent = '×'
  close.setAttribute('aria-label', t('shell.sharedClose'))
  el.append(text, save, own, close)
  container.appendChild(el)

  let timer: number | undefined
  let onSave: (() => void) | undefined
  let onOwn: (() => void) | undefined
  const hide = () => {
    window.clearTimeout(timer)
    el.hidden = true
  }
  save.addEventListener('click', () => onSave?.())
  own.addEventListener('click', () => onOwn?.())
  close.addEventListener('click', hide)

  return {
    showShared(handler, ownHandler) {
      window.clearTimeout(timer)
      onSave = handler
      onOwn = ownHandler
      own.hidden = false
      text.textContent = t('shell.sharedChip')
      save.hidden = false
      el.dataset.kind = 'shared'
      el.hidden = false
    },
    notice(message) {
      window.clearTimeout(timer)
      onSave = undefined
      onOwn = undefined
      text.textContent = message
      save.hidden = true
      own.hidden = true
      el.dataset.kind = 'notice'
      el.hidden = false
      timer = window.setTimeout(hide, NOTICE_MS)
    },
    hide,
  }
}
