import { getLang, setLang, t, type Lang } from './i18n'

const LABELS: Record<Lang, string> = { en: 'EN', it: 'IT' }

/** A quiet "EN · IT" switch: the current language is marked, the other one is a button that stores the choice and reloads. */
export function createLangSwitch(): HTMLElement {
  const box = document.createElement('span')
  box.className = 'langSwitch'
  box.setAttribute('role', 'group')
  box.setAttribute('aria-label', t('shell.language'))
  ;(['en', 'it'] as const).forEach((lang, i) => {
    if (i > 0) box.append(Object.assign(document.createElement('span'), { textContent: '·', ariaHidden: 'true' }))
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: LABELS[lang], lang })
    b.setAttribute('aria-pressed', String(lang === getLang()))
    b.addEventListener('click', () => setLang(lang))
    box.append(b)
  })
  return box
}
