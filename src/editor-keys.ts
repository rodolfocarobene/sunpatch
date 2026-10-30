import { t } from './i18n'

export type Tool = 'select' | 'outline' | 'wall' | 'window' | 'fix' | 'panel'

export type Shortcut = { tool: Tool } | { action: 'fit' }

/** Single-letter shortcuts, shown on the buttons. Space, Esc, Del and Ctrl+Z are handled elsewhere. */
export const TOOL_KEYS: Record<Tool, string> = { select: 'V', outline: 'O', wall: 'W', window: 'N', fix: 'B', panel: 'P' }
export const FIT_KEY = 'F'

/** The shortcut for a key press, or undefined for other keys and for keys held with Ctrl, Meta or Alt. */
export function shortcutFor(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): Shortcut | undefined {
  if (e.ctrlKey || e.metaKey || e.altKey) return undefined
  const key = e.key.toUpperCase()
  if (key === FIT_KEY) return { action: 'fit' }
  const tool = (Object.keys(TOOL_KEYS) as Tool[]).find((t) => TOOL_KEYS[t] === key)
  return tool ? { tool } : undefined
}

/** "1 window" / "3 windows". */
export const windowCount = (n: number): string => t('editor.windows', { n })

/** What replacing the outline costs, e.g. "Clears 3 windows"; '' when nothing is lost. */
export const clearsNote = (windows: number): string => (windows > 0 ? t('editor.clears', { windows: windowCount(windows) }) : '')
