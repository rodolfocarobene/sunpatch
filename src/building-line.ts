import type { Building } from './osm'

export interface BuildingLine {
  /** Name or street address from the OSM tags, when the data has one. */
  title: string | null
  /** "Relation 36488", "Map-tile outline"; `href` is the OSM page of a real object. */
  label: string
  href: string | null
  /** The rest of the line: "3 parts", "9 m", "3 levels". */
  facts: string[]
  /** Where the height came from, for a tooltip. */
  heightNote: string
}

const HEIGHT_SOURCE = {
  tag: 'from height tag',
  levels: 'from levels x 3 m',
  default: 'default, no data',
  tile: 'from map tiles',
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** The one-line identity of the selected building: "Relation 36488 · 9 m · 3 levels". */
export function buildingLine(b: Building): BuildingLine {
  const osmPath = b.id.split('#')[0]
  const tile = b.id.startsWith('tile/')
  const parts = b.members?.length ?? 1
  const street = [b.tags['addr:street'], b.tags['addr:housenumber']].filter(Boolean).join(' ')
  const facts: string[] = []
  if (parts > 1) facts.push(`${parts} parts`)
  facts.push(`${Math.round(b.height * 10) / 10} m`)
  if (b.levels !== undefined) facts.push(`${b.levels} ${b.levels === 1 ? 'level' : 'levels'}`)
  const min = b.minHeight > 0 ? `, starts at ${b.minHeight.toFixed(1)} m` : ''
  return {
    title: b.tags.name || street || null,
    label: tile ? 'Map-tile outline' : capitalise(osmPath.replace('/', ' ')),
    href: tile ? null : `https://www.openstreetmap.org/${osmPath}`,
    facts,
    heightNote: `Height ${b.height.toFixed(1)} m (${HEIGHT_SOURCE[b.heightSource]}${min})${b.levels === undefined ? '; levels unknown' : ''}`,
  }
}
