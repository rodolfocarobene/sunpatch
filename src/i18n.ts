/**
 * Sunpatch i18n: English (the source) and Italian, no dependencies.
 *
 * HOW TO ADD TEXT
 * - The dictionary is split in sections, one file each in `src/i18n/` (shell.ts, buildings.ts, sun.ts, ...). A section is
 *   `export const x = defineStrings({ en: {...}, it: {...} })`; the two languages must have the same keys (the type
 *   checks it). Keys are `section.name` so sections never collide.
 * - Register a new section with one line in `src/i18n/index.ts` (import it and spread it into `en` and `it`).
 * - In code: `t('shell.back')`, `t('buildings.parts', { n: 3 })`. `{name}` in a message is replaced by the param.
 *   A plural message is `{ one: '{n} floor', other: '{n} floors' }`; the `n` param picks the form (Intl.PluralRules).
 * - A key missing from `it` falls back to `en`; the unit test in `i18n.test.ts` also fails if that happens.
 * - Numbers and dates go through `fmtNumber`, `fmtTime`, `fmtDay` (current locale), never `toLocaleString('en')`.
 * - The language is chosen once per page load (stored choice, else the browser's) and `<html lang>` is set from it.
 *   Switching stores the choice and reloads the page (see `setLang`), so text built at load time needs no re-render.
 */
import { en, it, type Key } from './i18n/index'
import type { Message } from './i18n/define'

export type Lang = 'en' | 'it'
export type { Key }
export const LANGS: readonly Lang[] = ['en', 'it']
export const LANG_KEY = 'sunpatch.lang'

const DICTIONARIES: Record<Lang, Partial<Record<Key, Message>>> = { en, it }
/** Locales for Intl: British English keeps the day-first dates and 24-hour times the app always showed. */
const LOCALES: Record<Lang, string> = { en: 'en-GB', it: 'it-IT' }

/** The language for a browser language list: any `it*` is Italian, everything else English. */
export function detectLang(languages: readonly string[]): Lang {
  const first = languages.find(Boolean)
  return first && /^it\b/i.test(first) ? 'it' : 'en'
}

/** Stored choice if valid, else the browser's language; English outside a browser (tests). */
export function initialLang(): Lang {
  try {
    const stored = localStorage.getItem(LANG_KEY)
    if (stored === 'en' || stored === 'it') return stored
  } catch { /* storage blocked: follow the browser */ }
  if (typeof navigator === 'undefined' || typeof document === 'undefined') return 'en'
  return detectLang(navigator.languages?.length ? navigator.languages : [navigator.language])
}

let lang: Lang = initialLang()
if (typeof document !== 'undefined') document.documentElement.lang = lang

export const getLang = (): Lang => lang
export const locale = (): string => LOCALES[lang]

/** Sets the language without reloading (tests); `setLang` is the user's switch. */
export function useLang(next: Lang): void {
  lang = next
  if (typeof document !== 'undefined') document.documentElement.lang = next
}

const beforeSwitch: (() => void)[] = []
/** Runs just before the page reloads for a language switch: the place to save state the reload would lose. */
export const onBeforeLangSwitch = (fn: () => void): void => void beforeSwitch.push(fn)

/** The user's switch: stores the choice and reloads, so every string (static, built or cached) is rebuilt in the new language. */
export function setLang(next: Lang): void {
  if (next === lang) return
  try {
    localStorage.setItem(LANG_KEY, next)
  } catch { /* storage blocked: the reload falls back to the browser's language */ }
  for (const fn of beforeSwitch) fn()
  location.reload()
}

export type Params = Record<string, string | number>

function pick(message: Message, params?: Params): string {
  if (typeof message === 'string') return message
  return message[new Intl.PluralRules(locale()).select(Number(params?.n)) === 'one' ? 'one' : 'other']
}

/** The text for `key` in the current language (English when it has no Italian yet), with `{name}` replaced from `params` (a numeric `n` is also formatted for the locale). */
export function t(key: Key, params?: Params): string {
  const text = pick(DICTIONARIES[lang][key] ?? en[key], params)
  const show = (name: string, value: string | number) => (name === 'n' && typeof value === 'number' ? fmtNumber(value) : String(value))
  return params ? text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? show(name, params[name]) : whole)) : text
}

export const fmtNumber = (n: number, options?: Intl.NumberFormatOptions): string => n.toLocaleString(locale(), options)

/** 24-hour HH:MM in the current locale, or '' for a missing or invalid date. */
export function fmtTime(d: Date | null): string {
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', hour12: false }) : ''
}

/** The one short date format of the app: "21 Dec" / "21 dic" (month is 0-11). */
export function fmtDay(month: number, day: number): string {
  return new Date(2001, month, day).toLocaleDateString(locale(), { day: 'numeric', month: 'short' }).replace(/\.$/, '')
}

/** A length or count with at most one decimal ("9.5", "9" / "9,5" in Italian), rounded as `Math.round(x * 10) / 10` was. */
export const fmt1 = (n: number): string => fmtNumber(Math.round(n * 10) / 10, { maximumFractionDigits: 1 })

/** Exactly one decimal ("9.0"), where the digit matters (heights in the tooltips). */
export const fmt1Fixed = (n: number): string => fmtNumber(n, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
