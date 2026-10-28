import type { Building, Point } from './osm'
import type { Plan } from './plan'
import { ringOf } from './plan'
import type { Snap } from './editor-geom'

export interface View {
  /** Scene point shown at the centre of the SVG. */
  cx: number
  cz: number
  /** Pixels per metre. */
  scale: number
  w: number
  h: number
}

export interface Selection {
  kind: 'window' | 'wall'
  index: number
}

export interface Draft {
  outline: Point[]
  wallStart?: Point
  cursor?: Point
  snap?: Snap
}

export interface Scene {
  building: Building
  neighbors: Building[]
  plan: Plan
  view: View
  selection: Selection | null
  draft: Draft
}

const NS = 'http://www.w3.org/2000/svg'
export const NORTH_ARROW_POS = { x: 320, y: 56 }
export const SCALE_BAR_POS = { x: 300, y: 56 }

function svgEl(parent: Element, name: string, attrs: Record<string, string | number>): SVGElement {
  const el = document.createElementNS(NS, name)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v))
  parent.appendChild(el)
  return el as SVGElement
}

const pathOf = (rings: Point[][], closed = true): string =>
  rings.map((r) => 'M' + r.map((p) => `${p.x} ${p.z}`).join('L') + (closed ? 'Z' : '')).join('')

export function windowSegment(plan: Plan, i: number): [Point, Point] {
  const w = plan.windows[i]
  const ring = ringOf(plan, w.ring)
  const a = ring[w.edge]
  const b = ring[(w.edge + 1) % ring.length]
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1
  const ux = (b.x - a.x) / len
  const uz = (b.z - a.z) / len
  const c = { x: a.x + (b.x - a.x) * w.t, z: a.z + (b.z - a.z) * w.t }
  const half = w.width / 2
  return [
    { x: c.x - ux * half, z: c.z - uz * half },
    { x: c.x + ux * half, z: c.z + uz * half },
  ]
}

function niceLength(maxMetres: number): number {
  for (const n of [500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5]) if (n <= maxMetres) return n
  return 0.5
}

function drawGrid(g: SVGElement, v: View): void {
  const x0 = v.cx - v.w / 2 / v.scale
  const x1 = v.cx + v.w / 2 / v.scale
  const z0 = v.cz - v.h / 2 / v.scale
  const z1 = v.cz + v.h / 2 / v.scale
  const lines = (step: number, stroke: string): void => {
    let d = ''
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) d += `M${x} ${z0}V${z1}`
    for (let z = Math.ceil(z0 / step) * step; z <= z1; z += step) d += `M${x0} ${z}H${x1}`
    svgEl(g, 'path', { d, stroke, 'stroke-width': 1 / v.scale, fill: 'none' })
  }
  if (v.scale >= 10) lines(1, '#e6e9ed')
  lines(v.scale >= 2 ? 5 : 50, '#d0d5db')
}

export function drawScene(svg: SVGSVGElement, s: Scene): void {
  svg.replaceChildren()
  const { view: v, plan } = s
  const px = 1 / v.scale
  const root = svgEl(svg, 'g', {
    transform: `translate(${v.w / 2 - v.cx * v.scale} ${v.h / 2 - v.cz * v.scale}) scale(${v.scale})`,
  })
  drawGrid(root, v)

  for (const n of s.neighbors) {
    svgEl(root, 'path', {
      d: pathOf([n.outer, ...n.holes]),
      'fill-rule': 'evenodd',
      fill: '#dcdee2',
      stroke: '#c3c6cb',
      'stroke-width': px,
    })
  }
  svgEl(root, 'path', {
    d: pathOf([s.building.outer, ...s.building.holes]),
    'fill-rule': 'evenodd',
    fill: '#f1f3f6',
    stroke: '#8b95a3',
    'stroke-width': 1.5 * px,
    'stroke-dasharray': `${6 * px} ${4 * px}`,
  })
  svgEl(root, 'path', {
    d: pathOf([plan.outline.outer, ...plan.outline.holes]),
    'fill-rule': 'evenodd',
    fill: 'rgba(255, 170, 60, 0.28)',
    stroke: '#b85a08',
    'stroke-width': 2.5 * px,
    'stroke-linejoin': 'round',
  })

  plan.walls.forEach((w, i) => {
    const sel = s.selection?.kind === 'wall' && s.selection.index === i
    const line = { x1: w.a.x, y1: w.a.z, x2: w.b.x, y2: w.b.z }
    if (sel) svgEl(root, 'line', { ...line, stroke: '#ff7a00', 'stroke-width': w.thickness + 6 * px, 'stroke-linecap': 'round', opacity: 0.5 })
    svgEl(root, 'line', { ...line, stroke: '#3a3f47', 'stroke-width': w.thickness })
  })

  plan.windows.forEach((_, i) => {
    const [a, b] = windowSegment(plan, i)
    const line = { x1: a.x, y1: a.z, x2: b.x, y2: b.z }
    if (s.selection?.kind === 'window' && s.selection.index === i) {
      svgEl(root, 'line', { ...line, stroke: '#ff7a00', 'stroke-width': 0.3 + 8 * px, opacity: 0.6 })
    }
    svgEl(root, 'line', { ...line, stroke: '#14b8d9', 'stroke-width': 0.3 })
    svgEl(root, 'line', { ...line, stroke: '#0a6f85', 'stroke-width': px })
  })

  if (s.selection?.kind === 'wall') {
    const w = plan.walls[s.selection.index]
    for (const p of [w.a, w.b]) {
      svgEl(root, 'circle', { cx: p.x, cy: p.z, r: 5 * px, fill: '#fff', stroke: '#ff7a00', 'stroke-width': 2 * px })
    }
  }

  drawDraft(root, s, px)
  drawOverlay(svg, v)
}

function drawDraft(root: SVGElement, s: Scene, px: number): void {
  const { draft } = s
  const guide = { stroke: '#d9480f', 'stroke-width': 2 * px, 'stroke-dasharray': `${5 * px} ${3 * px}`, fill: 'none' }
  const pts = draft.outline
  if (pts.length) {
    const live = draft.cursor ? [...pts, draft.cursor] : pts
    svgEl(root, 'path', { d: pathOf([live], false), ...guide })
    for (const p of pts) svgEl(root, 'circle', { cx: p.x, cy: p.z, r: 3.5 * px, fill: '#d9480f' })
  }
  let label: { at: Point; text: string } | undefined
  if (draft.wallStart && draft.cursor) {
    const a = draft.wallStart
    const b = draft.cursor
    svgEl(root, 'line', { x1: a.x, y1: a.z, x2: b.x, y2: b.z, stroke: '#d9480f', 'stroke-width': DEFAULT_PREVIEW, opacity: 0.6 })
    label = { at: b, text: `${Math.hypot(b.x - a.x, b.z - a.z).toFixed(2)} m` }
  } else if (pts.length && draft.cursor) {
    const a = pts[pts.length - 1]
    label = { at: draft.cursor, text: `${Math.hypot(draft.cursor.x - a.x, draft.cursor.z - a.z).toFixed(2)} m` }
  }
  if (draft.snap && draft.snap.kind !== 'none') {
    const p = draft.snap.point
    const r = (draft.snap.kind === 'vertex' ? 6 : 4) * px
    svgEl(root, draft.snap.kind === 'vertex' ? 'rect' : 'circle', draft.snap.kind === 'vertex'
      ? { x: p.x - r, y: p.z - r, width: 2 * r, height: 2 * r, fill: 'none', stroke: '#e03131', 'stroke-width': 2 * px }
      : { cx: p.x, cy: p.z, r, fill: 'none', stroke: '#2f9e44', 'stroke-width': 2 * px })
  }
  if (label) {
    const t = svgEl(root, 'text', {
      x: label.at.x + 10 * px,
      y: label.at.z - 10 * px,
      'font-size': 12 * px,
      fill: '#222',
      stroke: '#fff',
      'stroke-width': 3 * px,
      'paint-order': 'stroke',
    })
    t.textContent = label.text
  }
}

const DEFAULT_PREVIEW = 0.1

function drawOverlay(svg: SVGSVGElement, v: View): void {
  const g = svgEl(svg, 'g', { fill: '#333', stroke: '#333', 'font-family': 'system-ui, sans-serif', 'font-size': 11 })
  const { x, y } = NORTH_ARROW_POS
  svgEl(g, 'path', { d: `M${x} ${y - 22}L${x + 7} ${y + 6}L${x} ${y + 1}L${x - 7} ${y + 6}Z`, 'stroke-width': 1 })
  const n = svgEl(g, 'text', { x, y: y - 27, 'text-anchor': 'middle', stroke: 'none' })
  n.textContent = 'N'
  const len = niceLength(140 / v.scale)
  const bx = SCALE_BAR_POS.x
  const by = v.h - SCALE_BAR_POS.y
  svgEl(g, 'path', { d: `M${bx} ${by - 5}V${by}H${bx + len * v.scale}V${by - 5}`, fill: 'none', 'stroke-width': 2 })
  const t = svgEl(g, 'text', { x: bx, y: by - 9, stroke: 'none' })
  t.textContent = `${len} m`
}
