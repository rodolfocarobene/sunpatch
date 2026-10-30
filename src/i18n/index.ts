import { buildings } from './buildings'
import { editor } from './editor'
import { garden } from './garden'
import { panels } from './panels'
import { shell } from './shell'
import { sun } from './sun'

/**
 * Every section of the dictionary. To add one (say `src/i18n/editor.ts`), import it and add it in the three places
 * below; `Key` then knows its keys, so `t('editor.x')` is type checked.
 */
export const SECTIONS = [shell, buildings, sun, editor, panels, garden]

export const en = { ...shell.en, ...buildings.en, ...sun.en, ...editor.en, ...panels.en, ...garden.en }
export const it = { ...shell.it, ...buildings.it, ...sun.it, ...editor.it, ...panels.it, ...garden.it }
export type Key = keyof typeof en
