import { describe, expect, it } from 'vitest'
import { hiddenOutlines, parseOverpass, partsOf, type OverpassElement } from './osm'
import duomo from '../fixtures/overpass-milan-duomo.json'
import murat from '../fixtures/overpass-milan-via-murat.json'

const ORIGIN = { lat: 45.4642, lon: 9.19 }
const parse = (json: { elements: unknown[] }) => parseOverpass(json.elements as OverpassElement[], ORIGIN).buildings

describe('the Duomo of Milan (relation 18017026)', () => {
  const all = parse(duomo)
  const outline = all.find((b) => b.id === 'relation/18017026')!
  const parts = partsOf(outline, all)

  it('keeps its outline and all 34 parts, none hidden', () => {
    expect(outline).toBeDefined()
    expect(parts).toHaveLength(34)
    expect(hiddenOutlines(all).has(outline.id)).toBe(false)
  })

  it('raises the untagged outline to the lowest floating part, so the nave is a body under the spires', () => {
    expect(outline.heightSource).toBe('parts')
    expect(outline.height).toBe(50)
    expect(Math.min(...parts.filter((p) => p.minHeight > 0).map((p) => p.minHeight))).toBe(50)
  })

  it('leaves outlines with a height of their own, and covered outlines, alone', () => {
    const tagged = all.filter((b) => b.heightSource === 'tag' || b.heightSource === 'levels')
    expect(tagged.length).toBeGreaterThan(0)
    expect(all.filter((b) => b.heightSource === 'parts').map((b) => b.id)).toEqual(['relation/18017026'])
    expect(parse(murat).filter((b) => b.heightSource === 'parts')).toEqual([])
  })
})
