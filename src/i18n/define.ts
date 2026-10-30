/** One message: a string, or the one/other forms of a plural (picked by the `n` param of `t`). */
export type Message = string | { one: string; other: string }

/**
 * Declares one section of the dictionary. `en` and `it` must have the same keys: a missing one is a type error
 * here, so a section can never ship half translated.
 */
export function defineStrings<K extends string>(section: { en: Record<K, Message>; it: Record<K, Message> }) {
  return section
}
