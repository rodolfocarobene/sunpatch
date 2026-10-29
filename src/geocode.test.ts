import { describe, expect, it } from 'vitest'
import arbe from '../fixtures/nominatim-via-arbe-34.json'
import murat from '../fixtures/nominatim-via-murat-60.json'
import {
  buildingAt,
  highlightFeature,
  hitLabel,
  isStreetLevel,
  numberMatch,
  polygonFeature,
  rankHits,
  requestedHouseNumber,
  searchUrl,
  viewFor,
  type GeoHit,
} from './geocode'

const base: GeoHit = { lat: '45', lon: '9', display_name: 'x' }

describe('searchUrl', () => {
  it('asks for 6 jsonv2 results with polygons and biases to the view', () => {
    const u = new URL(searchUrl('via Roma 1', [9, 45, 10, 46], 'it-IT'))
    expect(u.searchParams.get('limit')).toBe('6')
    expect(u.searchParams.get('format')).toBe('jsonv2')
    expect(u.searchParams.get('polygon_geojson')).toBe('1')
    expect(u.searchParams.get('viewbox')).toBe('9,45,10,46')
    expect(u.searchParams.get('bounded')).toBe('0')
    expect(u.searchParams.get('accept-language')).toBe('it-IT')
    expect(u.searchParams.get('q')).toBe('via Roma 1')
  })
  it('omits viewbox without bounds', () => {
    expect(new URL(searchUrl('a')).searchParams.has('viewbox')).toBe(false)
  })
})

describe('viewFor', () => {
  it('zooms to 18 for buildings', () => {
    expect(viewFor({ ...base, category: 'building', type: 'yes' })).toEqual({ zoom: 18 })
  })
  it('fits the bounding box for other places', () => {
    const hit = { ...base, category: 'place', type: 'city', boundingbox: ['45', '46', '9', '10'] as GeoHit['boundingbox'] }
    expect(viewFor(hit)).toEqual({ bounds: [9, 45, 10, 46] })
  })
  it('falls back to zoom 18 without a box', () => {
    expect(viewFor({ ...base, category: 'place', type: 'city' })).toEqual({ zoom: 18 })
  })
})

describe('polygonFeature', () => {
  it('accepts polygons only', () => {
    expect(polygonFeature({ ...base, geojson: { type: 'Point', coordinates: [9, 45] } })).toBeNull()
    expect(polygonFeature({ ...base, geojson: { type: 'Polygon', coordinates: [] } })?.type).toBe('Feature')
  })
})

describe('buildingAt', () => {
  // ~11 m squares (0.0001 deg lat); lon scaled so they are roughly square at 45 deg.
  const sq = (lon: number, lat: number): [number, number][] => {
    const d = 0.0001
    const e = d / Math.cos((45 * Math.PI) / 180)
    return [[lon, lat], [lon + e, lat], [lon + e, lat + d], [lon, lat + d], [lon, lat]]
  }
  const merged = {
    geometry: { type: 'MultiPolygon', coordinates: [[sq(9, 45)], [sq(9.001, 45)]] },
    properties: { render_height: 21, render_min_height: 0 },
  }

  it('picks only the polygon of a merged MultiPolygon that contains the point', () => {
    const hit = buildingAt([merged], 9.00105, 45.00005)
    expect(hit?.polygon[0][0]).toEqual([9.001, 45])
    expect(hit?.height).toBe(21)
  })

  it('snaps to a building a few metres away, but not to a far one', () => {
    expect(buildingAt([merged], 9.00105, 45.00013)?.polygon[0][0]).toEqual([9.001, 45])
    expect(buildingAt([merged], 9.0005, 45.001)).toBeNull()
  })
})

describe('house numbers', () => {
  // Real Nominatim answer for "via Arbe 34 Milano": three pieces of the street, no house number 34.
  const arbeHits = arbe as unknown as GeoHit[]
  const house = (n: string, over: Partial<GeoHit> = {}): GeoHit => ({
    ...base, category: 'place', type: 'house', address: { house_number: n, road: 'Via Arbe' }, ...over,
  })

  it('reads the house number from the query, not the postcode', () => {
    expect(requestedHouseNumber('via Arbe 34 Milano')).toBe('34')
    expect(requestedHouseNumber('via Roma 12/b, Milano')).toBe('12/b')
    expect(requestedHouseNumber('via Roma 12b 20125 Milano')).toBe('12b')
    expect(requestedHouseNumber('Duomo Milano')).toBeUndefined()
    expect(requestedHouseNumber('20122 Milano')).toBeUndefined()
  })

  it('asks Nominatim for the address details used to compare numbers', () => {
    expect(new URL(searchUrl('via Arbe 34')).searchParams.get('addressdetails')).toBe('1')
  })

  it('recognises the fixture answer as streets without a house number (the via Arbe 34 bug)', () => {
    expect(arbeHits.length).toBeGreaterThan(0)
    for (const hit of arbeHits) {
      expect(isStreetLevel(hit)).toBe(true)
      expect(numberMatch(hit, '34')).toBe('street')
      expect(hitLabel(hit, 'via Arbe 34 Milano')).toBe('street only, no house number 34 in the data')
    }
    for (const hit of murat as unknown as GeoHit[]) expect(numberMatch(hit, '60')).toBe('street')
  })

  it('outlines a street as a line and never as a building', () => {
    const feature = highlightFeature(arbeHits[0])
    expect(feature?.geometry.type).toBe('LineString')
    expect(highlightFeature(house('34'))).toBeNull()
  })

  it('ranks the exact house first, then other numbers, then bare streets', () => {
    const street = arbeHits[0]
    const hits = [street, house('36'), house('34'), { ...base, category: 'amenity', type: 'cafe' }]
    const ranked = rankHits(hits, 'via Arbe 34 Milano')
    expect(ranked.map((h) => numberMatch(h, '34'))).toEqual(['exact', 'none', 'other', 'street'])
    expect(hitLabel(ranked[0], 'via Arbe 34')).toBe('house number 34')
    expect(hitLabel(ranked[2], 'via Arbe 34')).toBe('house number 36, not 34')
  })

  it('matches 12b and 12/B as the same number', () => {
    expect(numberMatch(house('12/B'), '12b')).toBe('exact')
  })

  it('keeps Nominatim order when the query has no number', () => {
    expect(rankHits(arbeHits, 'via Arbe Milano')).toBe(arbeHits)
    expect(hitLabel(arbeHits[0], 'via Arbe Milano')).toBe('highway / tertiary')
  })
})
