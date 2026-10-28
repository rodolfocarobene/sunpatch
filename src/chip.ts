export interface StatusChip {
  loading(): void
  /** Shows the text for a few seconds, then hides. */
  done(text: string): void
  /** Shows the text with a Retry button. */
  failed(text: string): void
  hide(): void
}

const DONE_MS = 3000

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
  retry.addEventListener('click', onRetry)
  el.append(text, retry)
  container.appendChild(el)

  let timer: number | undefined
  function show(kind: 'loading' | 'done' | 'failed', message: string) {
    window.clearTimeout(timer)
    el.hidden = false
    el.dataset.kind = kind
    text.textContent = message
    retry.hidden = kind !== 'failed'
  }
  function hide() {
    window.clearTimeout(timer)
    el.hidden = true
  }

  return {
    loading: () => show('loading', 'Loading detailed OpenStreetMap buildings...'),
    done(message) {
      show('done', message)
      timer = window.setTimeout(hide, DONE_MS)
    },
    failed: (message) => show('failed', message),
    hide,
  }
}
