import { describe, expect, it } from 'vitest'
import { polygonFeature, searchUrl, viewFor, type GeoHit } from './geocode'

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
