import { t } from './i18n'
import { touchOnly } from './touch'

const SEEN_KEY = 'sunpatch.heightsNote'

/** True until the user has dismissed the note once on this device (storage that throws or is empty counts as not seen). */
export function heightsNoteDue(storage: Pick<Storage, 'getItem'> | undefined): boolean {
  try {
    return storage?.getItem(SEEN_KEY) !== 'seen'
  } catch {
    return true
  }
}

/** The note shown when the app opens: heights are estimates and can be corrected. "Got it" hides it for good on this device. */
export function showHeightsNote(container: HTMLElement): void {
  if (!heightsNoteDue(globalThis.localStorage)) return
  const el = document.createElement('div')
  el.id = 'heightsNote'
  el.setAttribute('role', 'note')
  const text = document.createElement('span')
  text.textContent = t(touchOnly() ? 'shell.heightsNoteTouch' : 'shell.heightsNote')
  const ok = document.createElement('button')
  ok.type = 'button'
  ok.textContent = t('shell.heightsNoteOk')
  ok.addEventListener('click', () => {
    el.remove()
    try {
      localStorage.setItem(SEEN_KEY, 'seen')
    } catch {
      // Private mode or blocked storage: the note just comes back next time.
    }
  })
  el.append(text, ok)
  container.appendChild(el)
}
