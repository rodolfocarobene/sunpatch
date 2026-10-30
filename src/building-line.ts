import type { Building, HeightSource } from './osm'

export interface BuildingLine {
  /** Name or street address from the OSM tags, when the data has one. */
  title: string | null
  /** "OpenStreetMap" for a real object, "Map-tile outline" for a preview; `href` is the OSM page of a real object. */
  label: string
  href: string | null
  /** The OSM id as OSM names it ("Relation 36488"): for the link's tooltip and the hover note, not the visible label. */
  osmId: string | null
  /** The rest of the line: "3 parts", "9 m", "3 levels". */
  facts: string[]
  /** Where the height came from, for a tooltip. */
  heightNote: string
  /** Set when the height is a guess or the user's own: "height guessed: 9 m default"; null for heights from the data. */
  source: string | null
}

const HEIGHT_SOURCE: Record<HeightSource, string> = {
  tag: 'from height tag',
  levels: 'from levels x 3 m',
  default: 'default, no data',
  tile: 'from map tiles',
  parts: 'estimated from the parts above it',
  user: 'set by you',
}

/** The short label of a guessed or user-set height; null when the data has the height. */
export function heightSourceLabel(b: Building): string | null {
  if (b.heightSource === 'user') return 'height set by you'
  if (b.heightSource === 'default') return `height guessed: ${Math.round(b.height * 10) / 10} m default`
  if (b.heightSource === 'parts') return 'height estimated from its parts'
  return null
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** The one-line identity of the selected building: "OpenStreetMap · 9 m · 3 levels". */
export function buildingLine(b: Building): BuildingLine {
  const osmPath = b.id.split('#')[0]
  const tile = b.id.startsWith('tile/')
  const parts = b.members?.length ?? 1
  const street = [b.tags['addr:street'], b.tags['addr:housenumber']].filter(Boolean).join(' ')
  const facts: string[] = []
  if (parts > 1) facts.push(`${parts} parts`)
  facts.push(`${Math.round(b.height * 10) / 10} m`)
  if (b.levels !== undefined) facts.push(`${b.levels} ${b.levels === 1 ? 'level' : 'levels'}`)
  const was = b.dataHeight ? ` (the data had ${b.dataHeight.height.toFixed(1)} m: ${HEIGHT_SOURCE[b.dataHeight.heightSource]})` : ''
  const min = b.minHeight > 0 ? `, starts at ${b.minHeight.toFixed(1)} m` : ''
  return {
    title: b.tags.name || street || null,
    label: tile ? 'Map-tile outline' : 'OpenStreetMap',
    href: tile ? null : `https://www.openstreetmap.org/${osmPath}`,
    osmId: tile ? null : capitalise(osmPath.replace('/', ' ')),
    facts,
    heightNote: `Height ${b.height.toFixed(1)} m (${HEIGHT_SOURCE[b.heightSource]}${min})${was}${b.levels === undefined ? '; levels unknown' : ''}`,
    source: heightSourceLabel(b),
  }
}

/** The hover note on a building in 3D: its name or id, its height with where that came from, and how to change it. */
export function hoverLines(b: Building): string[] {
  const line = buildingLine(b)
  const height = [`${Math.round(b.height * 10) / 10} m`, line.source].filter(Boolean).join(' \u00b7 ')
  return [line.title ?? line.osmId ?? line.label, height, 'Right-click to edit the height']
}
