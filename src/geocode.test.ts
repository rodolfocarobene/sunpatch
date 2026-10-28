import { describe, expect, it } from 'vitest'
import { buildingAt, polygonFeature, searchUrl, viewFor, type GeoHit } from './geocode'

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
