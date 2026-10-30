import type { View } from './ui'

/**
 * What a language switch (a page reload) carries over: the picked building (the point that was clicked), the tab and
 * the date and time. Plans, heights and options are already in localStorage; this is the rest. Kept in
 * sessionStorage for the one reload, then dropped.
 */
export interface Session {
  lat: number
  lon: number
  view: View
  /** YYYY-MM-DD */
  date: string
  minutes: number
  /** The bundled Milan example was open (its edits are never saved, so it is reopened rather than picked). */
  example?: boolean
}

const KEY = 'sunpatch.session'
const VIEWS: readonly string[] = ['map', 'plan', '3d', 'panels', 'garden']

export function parseSession(raw: string | null): Session | null {
  if (!raw) return null
  try {
    const s = JSON.parse(raw) as Partial<Session>
    const ok =
      Number.isFinite(s.lat) && Math.abs(s.lat!) <= 90 && Number.isFinite(s.lon) && Math.abs(s.lon!) <= 180 &&
      typeof s.view === 'string' && VIEWS.includes(s.view) &&
      typeof s.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.date) &&
      Number.isFinite(s.minutes) && s.minutes! >= 0 && s.minutes! < 1440
    return ok ? (s as Session) : null
  } catch {
    return null
  }
}

export function saveSession(session: Session): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(session))
  } catch { /* storage blocked: the reload starts fresh */ }
}

/** The saved session, once: it is removed so an ordinary reload later starts fresh. */
export function takeSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    sessionStorage.removeItem(KEY)
    return parseSession(raw)
  } catch {
    return null
  }
}
