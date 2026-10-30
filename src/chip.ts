export interface StatusChip {
  loading(): void
  /** Shows the text for a few seconds (longer with an action button, e.g. Undo), then hides. */
  done(text: string, action?: ChipAction): void
  /** Shows the text with a Retry button. */
  failed(text: string): void
  hide(): void
}

export interface ChipAction {
  label: string
  run(): void
}

const DONE_MS = 3000
const ACTION_MS = 8000

/** Small status chip in the corner of the 3D view. */
export function createStatusChip(container: HTMLElement, onRetry: () => void): StatusChip {
  const el = document.createElement('div')
  el.id = 'statusChip'
  el.hidden = true
  el.setAttribute('role', 'status')
  const text = document.createElement('span')
  const retry = document.createElement('button')
  retry.type = 'button'
  retry.textContent = 'Retry'
  let act: (() => void) | undefined
  retry.addEventListener('click', () => (act ?? onRetry)())
  el.append(text, retry)
  container.appendChild(el)

  let timer: number | undefined
  function show(kind: 'loading' | 'done' | 'failed', message: string, action?: ChipAction) {
    window.clearTimeout(timer)
    act = action && (() => (hide(), action.run()))
    retry.textContent = action?.label ?? 'Retry'
    el.hidden = false
    el.dataset.kind = kind
    text.textContent = message
    retry.hidden = kind !== 'failed' && !action
  }
  function hide() {
    window.clearTimeout(timer)
    el.hidden = true
  }

  return {
    loading: () => show('loading', 'Loading detailed OpenStreetMap buildings...'),
    done(message, action) {
      show('done', message, action)
      timer = window.setTimeout(hide, action ? ACTION_MS : DONE_MS)
    },
    failed: (message) => show('failed', message),
    hide,
  }
}
