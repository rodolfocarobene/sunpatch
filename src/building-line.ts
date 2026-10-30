import { fmt1, fmt1Fixed, t, type Key } from './i18n'
import { isGuessed } from './heights'
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
  /** The source is a guess or an estimate (not the user's own height). */
  guess: boolean
}

const HEIGHT_SOURCE: Record<HeightSource, Key> = {
  tag: 'bld.srcTag',
  levels: 'bld.srcLevels',
  default: 'bld.srcDefault',
  tile: 'bld.srcTile',
  parts: 'bld.srcParts',
  user: 'bld.srcUser',
}

/** The short label of a guessed or user-set height; null when the data has the height. */
export function heightSourceLabel(b: Building): string | null {
  if (b.heightSource === 'user') return t('bld.labelUser')
  if (b.heightSource === 'default') return t('bld.labelDefault', { h: fmt1(b.height) })
  if (b.heightSource === 'parts') return t('bld.labelParts')
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
  if (parts > 1) facts.push(t('bld.parts', { n: parts }))
  facts.push(`${fmt1(b.height)} m`)
  if (b.levels !== undefined) facts.push(t('bld.levels', { n: b.levels }))
  const was = b.dataHeight ? t('bld.heightWas', { h: fmt1Fixed(b.dataHeight.height), source: t(HEIGHT_SOURCE[b.dataHeight.heightSource]) }) : ''
  const min = b.minHeight > 0 ? t('bld.heightMin', { m: fmt1Fixed(b.minHeight) }) : ''
  return {
    title: b.tags.name || street || null,
    label: tile ? t('bld.tile') : t('bld.osm'),
    href: tile ? null : `https://www.openstreetmap.org/${osmPath}`,
    osmId: tile ? null : capitalise(osmPath.replace('/', ' ')),
    facts,
    heightNote: t('bld.heightNote', { h: fmt1Fixed(b.height), source: t(HEIGHT_SOURCE[b.heightSource]), min, was, levels: b.levels === undefined ? t('bld.levelsUnknown') : '' }),
    source: heightSourceLabel(b),
    guess: isGuessed(b),
  }
}

/** A building's name for a title or a label: its name or address, else "Neighbour building". */
export function buildingName(b: Building): string {
  return buildingLine(b).title ?? t('bld.neighbour')
}

/** The hover note on a building in 3D: its name or id, its height with where that came from, and how to change it. */
export function hoverLines(b: Building, ruler = false): string[] {
  const line = buildingLine(b)
  const height = [`${fmt1(b.height)} m`, line.source].filter(Boolean).join(' \u00b7 ')
  return [line.title ?? t('bld.neighbour'), height, ruler ? t('bld.hoverRuler') : t('bld.hoverEdit')]
}
