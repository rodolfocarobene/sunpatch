import { ringCentroid } from './osm'
import type { Building, Point } from './osm'
import type { Plan, Viewpoint } from './plan'
import { floorBase, ringOf } from './plan'
import type { Snap } from './editor-geom'
import { startPosition, windowYaw } from './walk-geom'

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
  kind: 'window' | 'wall' | 'edit' | 'viewpoint'
  /** Unused (0) for the viewpoint. */
  index: number
}

export const VIEW_LENGTH = 2.5
const VIEW_FOV = (70 * Math.PI) / 180

/** Unit look direction in (x, z) for a yaw (see walk-geom yawOf). */
export const viewDirection = (yaw: number): Point => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) })

/** The wedge tip, which doubles as the rotate handle. */
export function viewTip(vp: Viewpoint): Point {
  const d = viewDirection(vp.yaw)
  return { x: vp.x + d.x * VIEW_LENGTH, z: vp.z + d.z * VIEW_LENGTH }
}

let autoKey = ''
let autoValue: Viewpoint = { x: 0, z: 0, yaw: 0 }

/** Where "Walk inside" puts you: the fixed viewpoint, else the computed start (cached; the search can be slow). */
export function effectiveViewpoint(plan: Plan): Viewpoint & { auto: boolean } {
  if (plan.viewpoint) return { ...plan.viewpoint, auto: false }
  const key = JSON.stringify([plan.outline, plan.walls, plan.windows])
  if (key !== autoKey) {
    const pos = startPosition(plan)
    autoValue = { ...pos, yaw: windowYaw(plan, pos) }
    autoKey = key
  }
  return { ...autoValue, auto: true }
}

/** True when the edit's height range overlaps the plan's floor (floor surface to next floor surface). */
export function editOnFloor(plan: Plan, base: number, e: { bottom: number; top: number }): boolean {
  return e.bottom < base + plan.floorHeight && e.top > base
}

export interface Draft {
  outline: Point[]
  /** Wall tool: the chain's points so far (start, then each wall's end); the last one is where the next wall starts. */
  wallChain?: Point[]
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

// The warm app tokens of style.css (SVG attributes cannot read CSS variables).
const C = {
  surface: '#fffdf8',
  text: '#1f2a37',
  muted: '#526071',
  line: '#e6d9bd',
  lineStrong: '#d6c59f',
  band: '#f4ead6',
  accent: '#f5a623',
  accentStrong: '#b45f06',
}
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
  if (v.scale >= 10) lines(1, C.line)
  lines(v.scale >= 2 ? 5 : 50, C.lineStrong)
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
      fill: '#ece2cc',
      stroke: C.lineStrong,
      'stroke-width': px,
    })
  }
  svgEl(root, 'path', {
    d: pathOf([s.building.outer, ...s.building.holes]),
    'fill-rule': 'evenodd',
    fill: C.band,
    stroke: '#8a7f6a',
    'stroke-width': 1.5 * px,
    'stroke-dasharray': `${6 * px} ${4 * px}`,
  })
  drawEdits(root, s, px)
  svgEl(root, 'path', {
    'data-role': 'outline',
    d: pathOf([plan.outline.outer, ...plan.outline.holes]),
    'fill-rule': 'evenodd',
    fill: 'rgba(245, 166, 35, 0.3)',
    stroke: C.accentStrong,
    'stroke-width': 3 * px,
    'stroke-linejoin': 'round',
  })

  plan.walls.forEach((w, i) => {
    const sel = s.selection?.kind === 'wall' && s.selection.index === i
    const line = { x1: w.a.x, y1: w.a.z, x2: w.b.x, y2: w.b.z }
    if (sel) svgEl(root, 'line', { ...line, stroke: C.accent, 'stroke-width': w.thickness + 8 * px, 'stroke-linecap': 'round', opacity: 0.7 })
    svgEl(root, 'line', { ...line, stroke: C.text, 'stroke-width': Math.max(w.thickness, 2 * px) })
  })

  // A window is a pale gap in a slate frame, at least 8 px thick however far out the view is zoomed.
  const windowThickness = Math.max(0.3, 8 * px)
  plan.windows.forEach((_, i) => {
    const [a, b] = windowSegment(plan, i)
    const line = { x1: a.x, y1: a.z, x2: b.x, y2: b.z }
    if (s.selection?.kind === 'window' && s.selection.index === i) {
      svgEl(root, 'line', { ...line, stroke: C.accent, 'stroke-width': windowThickness + 10 * px, 'stroke-linecap': 'round', opacity: 0.85 })
    }
    svgEl(root, 'line', { ...line, stroke: C.text, 'stroke-width': windowThickness })
    svgEl(root, 'line', { ...line, stroke: C.surface, 'stroke-width': windowThickness - 4 * px })
  })

  if (s.selection?.kind === 'wall') {
    const w = plan.walls[s.selection.index]
    for (const p of [w.a, w.b]) {
      svgEl(root, 'circle', { cx: p.x, cy: p.z, r: 5 * px, fill: C.surface, stroke: C.accentStrong, 'stroke-width': 2 * px })
    }
  }

  drawViewpoint(root, s, px)
  drawDraft(root, s, px)
  drawOverlay(svg, v)
}

function drawEdits(root: SVGElement, s: Scene, px: number): void {
  const { plan } = s
  if (!plan.edits?.length) return
  const defs = svgEl(root, 'defs', {})
  const hatch = svgEl(defs, 'pattern', {
    id: 'edit-hatch', patternUnits: 'userSpaceOnUse', width: 6 * px, height: 6 * px, patternTransform: 'rotate(45)',
  })
  svgEl(hatch, 'line', { x1: 0, y1: 0, x2: 0, y2: 6 * px, stroke: '#7048e8', 'stroke-width': 2 * px })
  const base = floorBase(s.building, plan)
  plan.edits.forEach((e, i) => {
    const sel = s.selection?.kind === 'edit' && s.selection.index === i
    const g = svgEl(root, 'g', { opacity: editOnFloor(plan, base, e) ? 1 : 0.35 })
    const d = pathOf([e.outline])
    if (sel) svgEl(g, 'path', { d, fill: 'none', stroke: C.accent, 'stroke-width': 8 * px, opacity: 0.7, 'stroke-linejoin': 'round' })
    if (e.kind === 'add') {
      svgEl(g, 'path', { d, fill: 'rgba(112, 72, 232, 0.2)', stroke: 'none' })
      svgEl(g, 'path', { d, fill: 'url(#edit-hatch)', stroke: '#3b2a8c', 'stroke-width': 2 * px, 'stroke-linejoin': 'round' })
    } else {
      svgEl(g, 'path', {
        d, fill: 'rgba(224, 49, 49, 0.14)', stroke: '#c92a2a', 'stroke-width': 2 * px,
        'stroke-dasharray': `${6 * px} ${4 * px}`, 'stroke-linejoin': 'round',
      })
    }
    const c = ringCentroid(e.outline)
    const range = `${e.bottom.toFixed(1)}\u2013${e.top.toFixed(1)} m`
    const t = svgEl(g, 'text', {
      x: c.x, y: c.z, 'font-size': 11 * px, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
      fill: e.kind === 'add' ? '#3b2a8c' : '#a61e1e', stroke: C.surface, 'stroke-width': 3 * px, 'paint-order': 'stroke',
    })
    t.textContent = e.kind === 'add' ? `+${range}` : `cut ${range}`
    if (sel) {
      for (const p of e.outline) {
        svgEl(g, 'circle', { cx: p.x, cy: p.z, r: 5 * px, fill: C.surface, stroke: C.accentStrong, 'stroke-width': 2 * px })
      }
    }
  })
}

function drawViewpoint(root: SVGElement, s: Scene, px: number): void {
  const vp = effectiveViewpoint(s.plan)
  const sel = s.selection?.kind === 'viewpoint'
  // Slate camera, amber heading wedge; the automatic spot is the same in a lighter slate with a dashed wedge.
  const color = vp.auto ? C.muted : C.text
  const g = svgEl(root, 'g', { 'data-role': 'viewpoint' })
  const title = svgEl(g, 'title', {})
  title.textContent = `This is where Walk inside puts you${vp.auto ? ' (automatic: drag to fix it)' : ''}`
  const a0 = vp.yaw - VIEW_FOV / 2
  const a1 = vp.yaw + VIEW_FOV / 2
  const at = (a: number): string => `${vp.x - Math.sin(a) * VIEW_LENGTH} ${vp.z - Math.cos(a) * VIEW_LENGTH}`
  svgEl(g, 'path', {
    d: `M${vp.x} ${vp.z}L${at(a0)}A${VIEW_LENGTH} ${VIEW_LENGTH} 0 0 0 ${at(a1)}Z`,
    fill: vp.auto ? 'rgba(245, 166, 35, 0.22)' : 'rgba(245, 166, 35, 0.42)',
    stroke: C.accentStrong, 'stroke-width': 1.5 * px, 'stroke-dasharray': vp.auto ? `${4 * px} ${3 * px}` : 'none', 'stroke-linejoin': 'round',
  })
  const tip = viewTip(vp)
  if (sel) svgEl(g, 'circle', { cx: vp.x, cy: vp.z, r: 15 * px, fill: 'none', stroke: C.accent, 'stroke-width': 4 * px, opacity: 0.85 })
  svgEl(g, 'circle', { cx: vp.x, cy: vp.z, r: 10 * px, fill: color, stroke: C.surface, 'stroke-width': 2 * px })
  // camera glyph: body, viewfinder bump, lens
  svgEl(g, 'rect', { x: vp.x - 6 * px, y: vp.z - 3.5 * px, width: 12 * px, height: 8 * px, rx: 1.5 * px, fill: C.surface })
  svgEl(g, 'rect', { x: vp.x - 3 * px, y: vp.z - 5.5 * px, width: 6 * px, height: 3 * px, rx: px, fill: C.surface })
  svgEl(g, 'circle', { cx: vp.x, cy: vp.z + 0.5 * px, r: 2.5 * px, fill: color })
  svgEl(g, 'circle', { cx: tip.x, cy: tip.z, r: 5 * px, fill: C.surface, stroke: C.accentStrong, 'stroke-width': 2 * px })
  // The label sits behind the camera, away from the wedge.
  const back = viewDirection(vp.yaw)
  const label = svgEl(g, 'text', {
    x: vp.x - back.x * 22 * px, y: vp.z - back.z * 22 * px, 'font-size': 12 * px, 'font-weight': 600,
    'text-anchor': 'middle', 'dominant-baseline': 'middle',
    fill: C.text, stroke: C.surface, 'stroke-width': 3.5 * px, 'paint-order': 'stroke',
  })
  label.textContent = 'Walk start'
}

function drawDraft(root: SVGElement, s: Scene, px: number): void {
  const { draft } = s
  const guide = { stroke: C.accentStrong, 'stroke-width': 2 * px, 'stroke-dasharray': `${5 * px} ${3 * px}`, fill: 'none' }
  const pts = draft.outline
  if (pts.length) {
    const live = draft.cursor ? [...pts, draft.cursor] : pts
    svgEl(root, 'path', { d: pathOf([live], false), ...guide })
    for (const p of pts) svgEl(root, 'circle', { cx: p.x, cy: p.z, r: 3.5 * px, fill: C.accentStrong })
  }
  let label: { at: Point; text: string } | undefined
  if (draft.wallStart && draft.cursor) {
    const a = draft.wallStart
    const b = draft.cursor
    svgEl(root, 'line', { x1: a.x, y1: a.z, x2: b.x, y2: b.z, stroke: C.accentStrong, 'stroke-width': DEFAULT_PREVIEW, opacity: 0.6 })
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
      fill: C.text,
      stroke: C.surface,
      'stroke-width': 3 * px,
      'paint-order': 'stroke',
    })
    t.textContent = label.text
  }
}

const DEFAULT_PREVIEW = 0.1

function drawOverlay(svg: SVGSVGElement, v: View): void {
  const g = svgEl(svg, 'g', { fill: C.text, stroke: C.text, 'font-family': 'system-ui, sans-serif', 'font-size': 12 })
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
