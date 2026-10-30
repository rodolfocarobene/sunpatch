import { buildings } from './buildings'
import { editor } from './editor'
import { shell } from './shell'
import { sun } from './sun'

/**
 * Every section of the dictionary. To add one (say `src/i18n/editor.ts`), import it and add it in the three places
 * below; `Key` then knows its keys, so `t('editor.x')` is type checked.
 */
export const SECTIONS = [shell, buildings, sun, editor]

export const en = { ...shell.en, ...buildings.en, ...sun.en, ...editor.en }
export const it = { ...shell.it, ...buildings.it, ...sun.it, ...editor.it }
export type Key = keyof typeof en
