// Landing pages (index.html and it/index.html): remember the page's language for the app.
// The key is the same as LANG_KEY in i18n.ts; it is not imported because i18n.ts rewrites <html lang> on load.
const KEY = 'sunpatch.lang'

function store(lang: string): void {
  try {
    localStorage.setItem(KEY, lang)
  } catch { /* storage blocked: the app falls back to the browser's language */ }
}

for (const link of document.querySelectorAll<HTMLAnchorElement>('a[data-lang]')) {
  link.addEventListener('click', () => store(link.dataset.lang!))
}

// Italian browser, no stored choice, English page: offer the Italian page (no redirect).
try {
  if (document.documentElement.lang === 'en' && !localStorage.getItem(KEY) && navigator.language.toLowerCase().startsWith('it')) {
    document.getElementById('lang-hint')?.removeAttribute('hidden')
  }
} catch { /* storage blocked: no hint */ }
