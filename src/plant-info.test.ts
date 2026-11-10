import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  articleUrl, careLinks, clearPlantInfoCache, commonsFileName, commonsInfoUrl, creditFrom, creditText, loadPlantInfo, plainText, summaryUrl,
} from './plant-info'
import { PLANTS, plantById } from './plants'

const json = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 404, json: async () => body }) as Response

const SUMMARY = {
  type: 'standard',
  title: 'Basil',
  extract: 'Basil is a culinary herb.',
  thumbnail: { source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9d/Basil.jpg/320px-Basil.jpg', width: 320, height: 240 },
  content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Basil' } },
}
const META = {
  query: {
    pages: {
      '1': { imageinfo: [{ extmetadata: { Artist: { value: '<a href="//x">Jane &amp; Doe</a>' }, LicenseShortName: { value: 'CC BY-SA 4.0' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0' } } }] },
    },
  },
}

describe('catalogue', () => {
  it('has Wikipedia titles in both languages for every plant', () => {
    expect(PLANTS).toHaveLength(118)
    for (const p of PLANTS) {
      expect(p.wiki.en.trim(), p.id).not.toBe('')
      expect(p.wiki.it.trim(), p.id).not.toBe('')
      expect(p.wiki.en, p.id).toBe(p.wiki.en.trim())
      expect(p.wiki.it, p.id).toBe(p.wiki.it.trim())
    }
  })
})

describe('urls', () => {
  it('builds and encodes the summary and article urls', () => {
    expect(summaryUrl('en', 'Common fig')).toBe('https://en.wikipedia.org/api/rest_v1/page/summary/Common_fig')
    expect(summaryUrl('it', 'Viola × wittrockiana')).toBe('https://it.wikipedia.org/api/rest_v1/page/summary/Viola_%C3%97_wittrockiana')
    expect(articleUrl('it', 'Solanum lycopersicum')).toBe('https://it.wikipedia.org/wiki/Solanum_lycopersicum')
    expect(summaryUrl('en', 'A/B?c#d')).toContain('A%2FB%3Fc%23d')
  })

  it('finds the Commons file behind a picture url and builds the metadata query', () => {
    expect(commonsFileName(SUMMARY.thumbnail.source)).toBe('Basil.jpg')
    expect(commonsFileName('https://upload.wikimedia.org/wikipedia/commons/a/ab/Ocimum%20basilicum%20(1).jpg')).toBe('Ocimum basilicum (1).jpg')
    expect(commonsFileName('https://upload.wikimedia.org/wikipedia/en/thumb/a/ab/Logo.png/100px-Logo.png')).toBeUndefined()
    // The summary API now points thumbnails at thumb.wikimedia.org, with tracking query parameters.
    expect(
      commonsFileName('https://thumb.wikimedia.org/wikipedia/commons/thumb/9/97/Ocimum_basilicum_8zz.jpg/330px-Ocimum_basilicum_8zz.jpg?utm_source=en.wikipedia.org'),
    ).toBe('Ocimum_basilicum_8zz.jpg')
    const url = commonsInfoUrl('Ocimum basilicum (1).jpg')
    expect(url).toBe(
      'https://commons.wikimedia.org/w/api.php?action=query&titles=File%3AOcimum_basilicum_(1).jpg&prop=imageinfo&iiprop=extmetadata&format=json&origin=*',
    )
  })

  it('gives Wikipedia for both languages and an RHS search for English only', () => {
    const tomato = plantById('tomato')!
    expect(careLinks(tomato, 'en')).toEqual([
      { label: 'wikipedia', url: 'https://en.wikipedia.org/wiki/Tomato' },
      { label: 'rhs', url: 'https://www.rhs.org.uk/search?query=tomato' },
    ])
    expect(careLinks(tomato, 'it')).toEqual([{ label: 'wikipedia', url: 'https://it.wikipedia.org/wiki/Solanum_lycopersicum' }])
    expect(careLinks(plantById('bean')!, 'en')[1].url).toBe('https://www.rhs.org.uk/search?query=dwarf%20bean')
  })
})

describe('credit', () => {
  it('strips markup and entities from the author', () => {
    expect(plainText('<a href="//x">Jane &amp; Doe</a> &#169; &lt;3')).toBe('Jane & Doe © <3')
  })

  it('formats the credit line from extmetadata', () => {
    const credit = creditFrom(META.query.pages['1'].imageinfo[0].extmetadata, 'https://commons.wikimedia.org/wiki/File:Basil.jpg')
    expect(credit).toMatchObject({ artist: 'Jane & Doe', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0' })
    expect(creditText(credit, 'Photo')).toBe('Photo: Jane & Doe, CC BY-SA 4.0 · Wikimedia Commons')
  })

  it('still credits Wikimedia Commons when the metadata is missing', () => {
    const credit = creditFrom(undefined, 'https://commons.wikimedia.org/wiki/File:Basil.jpg')
    expect(credit.artist).toBeUndefined()
    expect(creditText(credit, 'Photo')).toBe('Wikimedia Commons')
    expect(creditText({ license: 'CC0' }, 'Foto')).toBe('Foto: CC0 · Wikimedia Commons')
  })

  it('ignores a licence url that is not http(s)', () => {
    expect(creditFrom({ LicenseUrl: { value: 'javascript:alert(1)' } }).licenseUrl).toBeUndefined()
    expect(creditFrom({ Artist: { value: 'Photo by David J. Stang' } }).artist).toBe('David J. Stang')
  })
})

describe('loadPlantInfo', () => {
  beforeEach(() => clearPlantInfoCache())

  it('reads the summary and the picture credit, then caches it', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => (String(url).includes('commons.wikimedia.org') ? json(META) : json(SUMMARY)))
    const info = await loadPlantInfo('en', 'Basil', fetchFn as unknown as typeof fetch)
    expect(info.extract).toBe('Basil is a culinary herb.')
    expect(info.image?.src).toContain('320px-Basil.jpg')
    expect(info.credit?.artist).toBe('Jane & Doe')
    expect(info.credit?.fileUrl).toBe('https://commons.wikimedia.org/wiki/File:Basil.jpg')
    expect(fetchFn).toHaveBeenCalledTimes(2)
    await loadPlantInfo('en', 'Basil', fetchFn as unknown as typeof fetch)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('keeps the picture, credited to Commons with the file link, when the metadata call fails', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('commons.wikimedia.org')) throw new TypeError('offline')
      return json(SUMMARY)
    })
    const info = await loadPlantInfo('en', 'Basil', fetchFn as unknown as typeof fetch)
    expect(info.image).toBeDefined()
    expect(info.credit).toEqual({ fileUrl: 'https://commons.wikimedia.org/wiki/File:Basil.jpg' })
  })

  it('has no picture and no credit when the article has no thumbnail', async () => {
    const fetchFn = vi.fn(async () => json({ extract: 'Text.', title: 'Mentha' }))
    const info = await loadPlantInfo('it', 'Mentha', fetchFn as unknown as typeof fetch)
    expect(info.image).toBeUndefined()
    expect(info.credit).toBeUndefined()
    expect(info.pageUrl).toBe('https://it.wikipedia.org/wiki/Mentha')
  })

  it('rejects offline, on an error status, on a disambiguation page, and does not cache the failure', async () => {
    await expect(loadPlantInfo('en', 'Basil', (async () => { throw new TypeError('offline') }) as unknown as typeof fetch)).rejects.toThrow()
    await expect(loadPlantInfo('en', 'Basil', (async () => json({}, false)) as unknown as typeof fetch)).rejects.toThrow('HTTP 404')
    await expect(loadPlantInfo('en', 'Basil', (async () => json({ type: 'disambiguation', extract: 'Basil may refer to' })) as unknown as typeof fetch)).rejects.toThrow()
    const fetchFn = vi.fn(async () => json({ extract: 'Back online.' }))
    await expect(loadPlantInfo('en', 'Basil', fetchFn as unknown as typeof fetch)).resolves.toMatchObject({ extract: 'Back online.' })
  })

  it('keys the cache by language', async () => {
    const fetchFn = vi.fn(async () => json({ extract: 'x' }))
    await loadPlantInfo('en', 'Mentha', fetchFn as unknown as typeof fetch)
    await loadPlantInfo('it', 'Mentha', fetchFn as unknown as typeof fetch)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })
})
