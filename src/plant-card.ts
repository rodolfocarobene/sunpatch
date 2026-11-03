import { fmt1, fmtNumber, getLang, t, upFirst, type Key } from './i18n'
import { careLinks, creditText, loadPlantInfo, type Credit, type PlantInfo } from './plant-info'
import { KIND_LABEL, type PlantRow } from './garden-text'
import { plantName, sunClass, type Plant, type SunClass } from './plants'

// The plant card: a picture and a short text from Wikipedia, the app's own facts about the plant, the verdict at the
// picked spot and care links. It floats on the right of the Garden view (inside the sheet on a phone); main.ts feeds it.

const SUN_LABEL: Record<SunClass, Key> = {
  'full sun': 'plant.sunFull',
  'part sun': 'plant.sunPart',
  'part shade': 'plant.sunPartShade',
  shade: 'plant.sunShade',
}

export interface Fact {
  label: string
  value: string
}

/** The app's own facts about a plant: no network needed. */
export function plantFacts(plant: Plant): Fact[] {
  const n = (v: number) => fmtNumber(v)
  const facts: Fact[] = [
    { label: t('plant.factKind'), value: upFirst(t(KIND_LABEL[plant.kind])) },
    { label: t('plant.factSun'), value: t('plant.sunValue', { cls: t(SUN_LABEL[sunClass(plant)]), min: n(plant.sun.min), ideal: n(plant.sun.ideal) }) },
    ...(plant.daylight
      ? [{ label: t('plant.factLight'), value: t('plant.lightValue', { min: fmt1(plant.daylight.min), ideal: fmt1(plant.daylight.ideal) }) }]
      : []),
    {
      label: t('plant.factTemp'),
      value: t('plant.tempValue', { min: n(plant.temp.min), max: n(plant.temp.max), lo: n(plant.temp.optLow), hi: n(plant.temp.optHigh), survive: n(plant.temp.survive) }),
    },
    { label: t('plant.factLife'), value: t(plant.life === 'annual' ? 'plant.annual' : 'plant.perennial') },
  ]
  if (plant.days !== undefined) facts.push({ label: t('plant.factDays'), value: t('plant.daysValue', { n: n(plant.days) }) })
  return facts
}

export interface PlantCardInput {
  plant: Plant
  /** The plant at the picked spot, when one is picked and rated. */
  here?: PlantRow
}

export interface PlantCard {
  el: HTMLElement
  /** Shows the card for a plant, or hides it with null. */
  set(input: PlantCardInput | null): void
}

const CLOSE_ICON =
  '<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>'

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] =>
  Object.assign(document.createElement(tag), { className, textContent: text })

const link = (href: string, text: string): HTMLAnchorElement =>
  Object.assign(document.createElement('a'), { href, textContent: text, target: '_blank', rel: 'noopener noreferrer' })

/** The credit line with links: "Photo: Jane Doe, CC BY-SA 4.0 · Wikimedia Commons". */
export function creditLine(credit: Credit): HTMLElement {
  const p = el('p', 'plantCredit')
  const who = el('span', '', credit.artist ?? '')
  if (credit.artist || credit.license) {
    p.append(`${t('plant.photo')}: `)
    if (credit.artist) p.append(who)
    if (credit.artist && credit.license) p.append(', ')
    if (credit.license) p.append(credit.licenseUrl ? link(credit.licenseUrl, credit.license) : credit.license)
    p.append(' · ')
  }
  p.append(credit.fileUrl ? link(credit.fileUrl, 'Wikimedia Commons') : 'Wikimedia Commons')
  p.title = creditText(credit, t('plant.photo'))
  return p
}

export function createPlantCard(options: { onClose: () => void }): PlantCard {
  const root = el('aside', 'plantCard')
  root.hidden = true
  root.setAttribute('role', 'region')
  const close = el('button', 'cardClose')
  close.type = 'button'
  close.title = t('sun.closeTitle')
  close.setAttribute('aria-label', t('sun.close'))
  close.innerHTML = CLOSE_ICON
  close.addEventListener('click', options.onClose)
  const body = el('div', 'plantBody')
  root.append(close, body)
  /** The plant whose card is up, so a late Wikipedia answer for an earlier plant is dropped. */
  let shownId = ''

  function wikiBlock(plant: Plant, info: PlantInfo | 'loading' | 'failed'): HTMLElement {
    const box = el('div', 'plantWiki')
    if (info === 'loading') {
      box.append(Object.assign(el('p', 'plantQuiet', t('plant.loading')), { role: 'status' }))
      return box
    }
    if (info === 'failed') {
      box.append(Object.assign(el('p', 'plantQuiet', t('plant.failed')), { role: 'status' }))
      return box
    }
    if (info.image) {
      const img = Object.assign(document.createElement('img'), { src: info.image.src, alt: upFirst(plantName(plant)), className: 'plantPhoto', width: info.image.width, height: info.image.height })
      img.referrerPolicy = 'no-referrer'
      img.loading = 'lazy'
      img.decoding = 'async'
      box.append(img)
      box.append(creditLine(info.credit ?? {}))
    }
    const text = el('p', 'plantExtract', info.extract)
    const from = el('p', 'plantCredit')
    from.append(link(info.pageUrl, t('plant.fromWiki')), ' · CC BY-SA')
    box.append(text, from)
    return box
  }

  function render(input: PlantCardInput, info: PlantInfo | 'loading' | 'failed') {
    const { plant, here } = input
    root.setAttribute('aria-label', t('plant.aria', { name: plantName(plant) }))
    const parts: HTMLElement[] = [el('h4', 'plantTitle', upFirst(plantName(plant)))]
    if (here) {
      const v = el('div', 'plantHere')
      v.append(el('strong', '', t('plant.here')), ' ', el('span', `rate ${here.rating}`, here.label), el('p', 'plantReason', here.reason))
      parts.push(v)
    }
    parts.push(wikiBlock(plant, info))
    const dl = el('dl', 'plantFacts')
    for (const f of plantFacts(plant)) dl.append(el('dt', '', f.label), el('dd', '', f.value))
    parts.push(dl)
    const care = el('div', 'plantCare')
    care.append(el('h5', '', t('plant.careHead')))
    const list = el('ul')
    for (const l of careLinks(plant, getLang())) {
      const li = el('li')
      li.append(link(l.url, l.label === 'wikipedia' ? t('plant.linkWiki') : t('plant.linkRhs', { name: plantName(plant) })))
      list.append(li)
    }
    care.append(list)
    parts.push(care)
    body.replaceChildren(...parts)
  }

  /** The last wiki answer per plant: a re-render for the same plant (month change, spot verdict) keeps the picture without a refetch. */
  let latest: PlantCardInput | undefined
  let last: { id: string; info: PlantInfo | 'loading' | 'failed' } | undefined

  return {
    el: root,
    set(input) {
      if (!input) {
        root.hidden = true
        shownId = ''
        last = undefined
        body.replaceChildren()
        return
      }
      root.hidden = false
      latest = input
      const { plant } = input
      if (plant.id === shownId && last) return render(input, last.info)
      shownId = plant.id
      last = { id: plant.id, info: 'loading' }
      render(input, 'loading')
      loadPlantInfo(getLang(), plant.wiki[getLang()]).then(
        (info) => {
          if (shownId !== plant.id) return
          last = { id: plant.id, info }
          render(latest!, info)
        },
        () => {
          if (shownId !== plant.id) return
          last = { id: plant.id, info: 'failed' }
          render(latest!, 'failed')
        },
      )
    },
  }
}
