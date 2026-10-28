import './editor.css'
import type { Building, Point } from './osm'
import { DEFAULT_WALL_THICKNESS, DEFAULT_WINDOW, levelCount, ringOf } from './plan'
import type { Plan } from './plan'
import {
  clampWindowT,
  constrainToDirections,
  distanceToSegment,
  nearestEdge,
  projectOnSegment,
  ringSegments,
  selfIntersects,
  snapPoint,
  unitDirection,
  validatePlan,
} from './editor-geom'
import type { Segment, Snap } from './editor-geom'
import { drawScene, windowSegment } from './editor-draw'
import type { Draft, Selection, View } from './editor-draw'

export interface PlanEditor {
  /** Shows `building` (and faint `neighbors` footprints for context) and edits `plan`. */
  open(building: Building, neighbors: Building[], plan: Plan): void
  setVisible(visible: boolean): void
  getPlan(): Plan
}

type Tool = 'select' | 'outline' | 'wall' | 'window'

const SNAP_PX = 10
const HIT_PX = 8
const MIN_SCALE = 1
const MAX_SCALE = 400
const MAX_HISTORY = 100
const storageKey = (buildingId: string): string => `sun-in-house:plan:${buildingId}`

const HELP: Record<Tool, string> = {
  select: 'Select: click a window or wall; drag a window along its edge or a wall end to move it. Drag empty space to pan.',
  outline: 'Outline: click points; double-click or click the first point to close; Esc cancels. Replaces the outline and clears windows.',
  wall: 'Wall: click start, click end (Shift = 0/90 deg to the nearest outline edge); Esc cancels.',
  window: 'Window: click near an outline edge to add a window; click an existing one to select it.',
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

export function loadSavedPlan(buildingId: string): Plan | null {
  try {
    const raw = localStorage.getItem(storageKey(buildingId))
    if (!raw) return null
    const result = validatePlan(JSON.parse(raw))
    return 'plan' in result && result.plan.buildingId === buildingId ? result.plan : null
  } catch {
    return null
  }
}

function savePlan(plan: Plan): void {
  try {
    localStorage.setItem(storageKey(plan.buildingId), JSON.stringify(plan))
  } catch {
    // storage unavailable or full: the plan just isn't remembered
  }
}

type Drag =
  | { kind: 'pan'; sx: number; sy: number; cx: number; cz: number }
  | { kind: 'window'; index: number; before: Plan }
  | { kind: 'wallEnd'; index: number; end: 'a' | 'b'; before: Plan }

function field(label: string, input: HTMLElement): HTMLLabelElement {
  const l = document.createElement('label')
  l.append(label, input)
  return l
}

function numberInput(value: number, step: number, min: number, onChange: (v: number) => void, max?: number): HTMLInputElement {
  const i = document.createElement('input')
  i.type = 'number'
  i.step = String(step)
  i.min = String(min)
  if (max !== undefined) i.max = String(max)
  i.value = String(Math.round(value * 1000) / 1000)
  i.addEventListener('change', () => {
    const v = Number(i.value)
    if (Number.isFinite(v) && v >= min && (max === undefined || v <= max)) onChange(v)
    else i.value = String(value)
  })
  return i
}

function button(text: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.textContent = text
  b.title = title
  b.addEventListener('click', onClick)
  return b
}

export function createPlanEditor(container: HTMLElement, onChange: (plan: Plan) => void): PlanEditor {
  const root = document.createElement('div')
  root.className = 'editor'
  root.hidden = true
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  const toolbar = document.createElement('div')
  toolbar.className = 'editor-box editor-toolbar'
  const props = document.createElement('div')
  props.className = 'editor-box editor-props'
  props.hidden = true
  const statusLine = document.createElement('div')
  statusLine.className = 'editor-status'
  const statusText = document.createElement('span')
  statusLine.appendChild(statusText)
  root.append(svg, toolbar, props, statusLine)
  container.appendChild(root)

  let building: Building | undefined
  let neighbors: Building[] = []
  let plan: Plan | undefined
  let history: Plan[] = []
  let tool: Tool = 'select'
  let selection: Selection | null = null
  let draft: Draft = { outline: [] }
  let drag: Drag | null = null
  let spaceDown = false
  let view: View = { cx: 0, cz: 0, scale: 10, w: 0, h: 0 }
  let needsFit = false
  let visible = false
  let message: { text: string; kind: 'info' | 'error' } | undefined

  // --- toolbar ---
  const toolButtons = new Map<Tool, HTMLButtonElement>()
  const toolRow = document.createElement('div')
  toolRow.className = 'editor-row'
  for (const [t, label] of [['select', 'Select'], ['outline', 'Outline'], ['wall', 'Wall'], ['window', 'Window']] as const) {
    const b = button(label, `${label} tool`, () => setTool(t))
    toolButtons.set(t, b)
    toolRow.appendChild(b)
  }
  const actionRow = document.createElement('div')
  actionRow.className = 'editor-row'
  const fileInput = document.createElement('input')
  fileInput.type = 'file'
  fileInput.accept = 'application/json,.json'
  fileInput.hidden = true
  fileInput.addEventListener('change', () => void importFile())
  actionRow.append(
    button('Whole floor', 'Reset the outline to the building footprint (clears windows)', wholeFloor),
    button('Undo', 'Undo (Ctrl+Z)', undo),
    button('Delete', 'Delete selected (Del)', deleteSelected),
    button('Export JSON', 'Download the plan as a JSON file', exportJson),
    button('Import JSON', 'Load a plan from a JSON file', () => fileInput.click()),
    fileInput,
  )
  const floorBox = document.createElement('div')
  floorBox.className = 'editor-row'
  floorBox.style.flexDirection = 'column'
  toolbar.append(toolRow, actionRow, floorBox)

  function setTool(t: Tool): void {
    tool = t
    draft = { outline: [] }
    root.dataset.tool = t
    for (const [name, b] of toolButtons) b.setAttribute('aria-pressed', String(name === t))
    message = undefined
    render()
  }

  function updateFloorBox(): void {
    if (!building || !plan) return
    const b = building
    const levels = levelCount(b)
    const info = document.createElement('small')
    info.textContent = `Building: ${levels} levels, ${(b.height - b.minHeight).toFixed(1)} m`
    floorBox.replaceChildren(
      field('Floor (0 = ground)', numberInput(plan.floor, 1, 0, (v) => commit({ ...clone(plan!), floor: Math.round(v) }), levels - 1)),
      field('Floor height (m)', numberInput(plan.floorHeight, 0.1, 0.1, (v) => commit({ ...clone(plan!), floorHeight: v }))),
      info,
    )
    props.style.setProperty('--props-top', `${toolbar.offsetHeight + 24}px`)
  }

  // --- properties ---
  function updateProps(force = false): void {
    if (!plan) return
    if (!force && props.contains(document.activeElement)) return
    if (!selection) {
      props.hidden = true
      return
    }
    props.hidden = false
    const p = plan
    const sel = selection
    if (sel.kind === 'window') {
      const w = p.windows[sel.index]
      const ring = ringOf(p, w.ring)
      const a = ring[w.edge]
      const b = ring[(w.edge + 1) % ring.length]
      const len = Math.hypot(b.x - a.x, b.z - a.z)
      const edit = (patch: Partial<typeof w>): void => {
        const next = clone(p)
        Object.assign(next.windows[sel.index], patch)
        commit(next)
        updateProps(true)
      }
      props.replaceChildren(
        Object.assign(document.createElement('h4'), { textContent: 'Window' }),
        field('Width (m)', numberInput(w.width, 0.1, 0.1, (v) => {
          const t = clampWindowT(w.t, v, len)
          if (t === null) return setMessage('Window is wider than its edge', 'error')
          edit({ width: v, t })
        })),
        field('Sill (m)', numberInput(w.sill, 0.1, 0, (v) => edit({ sill: v }))),
        field('Height (m)', numberInput(w.height, 0.1, 0.1, (v) => edit({ height: v }))),
        field('From edge start (m)', numberInput(w.t * len, 0.1, 0, (v) => {
          const t = clampWindowT(v / len, w.width, len)
          if (t !== null) edit({ t })
        })),
      )
    } else {
      const w = p.walls[sel.index]
      const len = document.createElement('output')
      len.textContent = `${Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z).toFixed(2)} m`
      props.replaceChildren(
        Object.assign(document.createElement('h4'), { textContent: 'Wall' }),
        field('Thickness (m)', numberInput(w.thickness, 0.01, 0.02, (v) => {
          const next = clone(p)
          next.walls[sel.index].thickness = v
          commit(next)
          updateProps(true)
        })),
        field('Length', len),
      )
    }
  }

  // --- status ---
  function setMessage(text: string, kind: 'info' | 'error' = 'info'): void {
    message = { text, kind }
    render()
  }

  // --- state changes ---
  function commit(next: Plan, previous: Plan | undefined = plan): void {
    if (previous) {
      history.push(previous)
      if (history.length > MAX_HISTORY) history.shift()
    }
    plan = next
    persist()
    render()
  }

  function persist(): void {
    if (!plan) return
    savePlan(plan)
    onChange(clone(plan))
  }

  function undo(): void {
    const prev = history.pop()
    if (!prev) return setMessage('Nothing to undo')
    plan = prev
    if (selection && !(selection.kind === 'window' ? plan.windows : plan.walls)[selection.index]) selection = null
    persist()
    render()
  }

  function wholeFloor(): void {
    if (!plan || !building) return
    const next = clone(plan)
    next.outline = { outer: clone(building.outer), holes: clone(building.holes) }
    next.windows = []
    selection = null
    commit(next)
    setMessage('Outline reset to the building footprint; windows cleared')
  }

  function deleteSelected(): void {
    if (!plan || !selection) return
    const next = clone(plan)
    ;(selection.kind === 'window' ? next.windows : next.walls).splice(selection.index, 1)
    selection = null
    commit(next)
  }

  function exportJson(): void {
    if (!plan) return
    const url = URL.createObjectURL(new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `plan-${plan.buildingId.replace(/[^\w.-]+/g, '_')}-floor${plan.floor}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function importFile(): Promise<void> {
    const file = fileInput.files?.[0]
    fileInput.value = ''
    if (!file || !plan) return
    let parsed: unknown
    try {
      parsed = JSON.parse(await file.text())
    } catch {
      return setMessage('Import failed: not valid JSON', 'error')
    }
    const result = validatePlan(parsed)
    if ('error' in result) return setMessage(`Import failed: ${result.error}`, 'error')
    if (result.plan.buildingId !== plan.buildingId &&
        !confirm(`This plan was drawn for ${result.plan.buildingId}, not ${plan.buildingId}. Use it anyway?`)) return
    selection = null
    commit({ ...result.plan, buildingId: plan.buildingId })
    setMessage('Plan imported')
  }

  // --- geometry in the current view ---
  const tol = (px: number): number => px / view.scale
  const toWorld = (sx: number, sy: number): Point => ({
    x: view.cx + (sx - view.w / 2) / view.scale,
    z: view.cz + (sy - view.h / 2) / view.scale,
  })
  function eventPoint(e: MouseEvent): Point {
    const r = svg.getBoundingClientRect()
    return toWorld(e.clientX - r.left, e.clientY - r.top)
  }

  function footprintRings(): Point[][] {
    return building ? [building.outer, ...building.holes] : []
  }

  function wallSnapTargets(skip: number | undefined): { vertices: Point[]; segments: Segment[] } {
    const vertices: Point[] = []
    const segments: Segment[] = []
    for (const ring of [plan!.outline.outer, ...plan!.outline.holes]) {
      vertices.push(...ring)
      segments.push(...ringSegments(ring))
    }
    plan!.walls.forEach((w, i) => {
      if (i === skip) return
      vertices.push(w.a, w.b)
      segments.push([w.a, w.b])
    })
    return { vertices, segments }
  }

  function snapForWall(p: Point, skip?: number): Snap {
    const { vertices, segments } = wallSnapTargets(skip)
    return snapPoint(p, vertices, segments, tol(SNAP_PX))
  }

  function snapForOutline(p: Point): Snap {
    const rings = footprintRings()
    return snapPoint(p, [...rings.flat(), ...draft.outline.slice(0, 1)], rings.flatMap(ringSegments), tol(SNAP_PX))
  }

  function constrainWall(start: Point, p: Point): Point {
    const segments = wallSnapTargets(undefined).segments.slice(0, plan!.outline.outer.length + plan!.outline.holes.reduce((n, h) => n + h.length, 0))
    let best: Segment | undefined
    let bestD = Infinity
    for (const [a, b] of segments) {
      const d = distanceToSegment(start, a, b)
      if (d < bestD) {
        bestD = d
        best = [a, b]
      }
    }
    const u = (best && unitDirection(best[0], best[1])) ?? { x: 1, z: 0 }
    return constrainToDirections(start, p, [u, { x: -u.z, z: u.x }])
  }

  function wallPoint(e: MouseEvent, start: Point | undefined, skip?: number): Snap {
    const p = eventPoint(e)
    if (e.shiftKey && start) return { point: constrainWall(start, p), kind: 'none' }
    return snapForWall(p, skip)
  }

  function hitWindow(p: Point): number {
    if (!plan) return -1
    let best = -1
    let bestD = Math.max(tol(HIT_PX), 0.2)
    plan.windows.forEach((_, i) => {
      const [a, b] = windowSegment(plan!, i)
      const d = distanceToSegment(p, a, b)
      if (d <= bestD) {
        bestD = d
        best = i
      }
    })
    return best
  }

  function hitWall(p: Point): number {
    if (!plan) return -1
    let best = -1
    let bestD = Infinity
    plan.walls.forEach((w, i) => {
      const d = distanceToSegment(p, w.a, w.b)
      if (d <= Math.max(w.thickness / 2, tol(HIT_PX)) && d < bestD) {
        bestD = d
        best = i
      }
    })
    return best
  }

  // --- tools ---
  function finishOutline(): void {
    if (!plan) return
    const pts = draft.outline
    if (pts.length < 3) return setMessage('An outline needs at least 3 points', 'error')
    if (selfIntersects(pts)) return setMessage('Outline crosses itself; adjust the points', 'error')
    const next = clone(plan)
    const hadWindows = next.windows.length > 0
    next.outline = { outer: clone(pts), holes: [] }
    next.windows = []
    selection = null
    draft = { outline: [] }
    commit(next)
    setMessage(hadWindows ? 'Outline replaced; its windows were cleared' : 'Outline replaced')
  }

  function outlineClick(e: MouseEvent): void {
    const snap = snapForOutline(eventPoint(e))
    const pts = draft.outline
    if (pts.length >= 3 && Math.hypot(snap.point.x - pts[0].x, snap.point.z - pts[0].z) < 1e-6) return finishOutline()
    const last = pts[pts.length - 1]
    if (last && Math.hypot(snap.point.x - last.x, snap.point.z - last.z) < tol(2)) return
    pts.push(snap.point)
    message = undefined
    render()
  }

  function wallClick(e: MouseEvent): void {
    if (!plan) return
    const snap = wallPoint(e, draft.wallStart)
    if (!draft.wallStart) {
      draft.wallStart = snap.point
      render()
      return
    }
    const a = draft.wallStart
    if (Math.hypot(snap.point.x - a.x, snap.point.z - a.z) < 0.05) return setMessage('Wall is too short', 'error')
    const next = clone(plan)
    next.walls.push({ a, b: snap.point, thickness: DEFAULT_WALL_THICKNESS })
    draft = { outline: [] }
    selection = { kind: 'wall', index: next.walls.length - 1 }
    commit(next)
  }

  function windowClick(e: MouseEvent): void {
    if (!plan) return
    const p = eventPoint(e)
    const existing = hitWindow(p)
    if (existing >= 0) {
      selection = { kind: 'window', index: existing }
      return render()
    }
    const rings = [plan.outline.outer, ...plan.outline.holes]
    const edge = nearestEdge(rings, p, tol(SNAP_PX * 1.5))
    if (!edge) return setMessage('Click closer to an outline edge', 'error')
    const ring = rings[edge.ring]
    const a = ring[edge.edge]
    const b = ring[(edge.edge + 1) % ring.length]
    const t = clampWindowT(edge.t, DEFAULT_WINDOW.width, Math.hypot(b.x - a.x, b.z - a.z))
    if (t === null) return setMessage('That edge is too short for a window', 'error')
    const next = clone(plan)
    next.windows.push({ ring: edge.ring, edge: edge.edge, t, ...DEFAULT_WINDOW })
    selection = { kind: 'window', index: next.windows.length - 1 }
    message = undefined
    commit(next)
  }

  function selectDown(e: PointerEvent): void {
    if (!plan) return
    const p = eventPoint(e)
    if (selection?.kind === 'wall') {
      const w = plan.walls[selection.index]
      const end = [['a', w.a], ['b', w.b]].find(([, q]) => Math.hypot((q as Point).x - p.x, (q as Point).z - p.z) <= tol(HIT_PX))
      if (end) {
        drag = { kind: 'wallEnd', index: selection.index, end: end[0] as 'a' | 'b', before: clone(plan) }
        return
      }
    }
    const wi = hitWindow(p)
    if (wi >= 0) {
      selection = { kind: 'window', index: wi }
      drag = { kind: 'window', index: wi, before: clone(plan) }
      return render()
    }
    const wl = hitWall(p)
    if (wl >= 0) {
      selection = { kind: 'wall', index: wl }
      return render()
    }
    selection = null
    startPan(e)
    render()
  }

  function startPan(e: PointerEvent): void {
    drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, cx: view.cx, cz: view.cz }
    root.classList.add('panning')
  }

  function dragMove(e: PointerEvent): void {
    if (!plan || !drag) return
    if (drag.kind === 'pan') {
      view.cx = drag.cx - (e.clientX - drag.sx) / view.scale
      view.cz = drag.cz - (e.clientY - drag.sy) / view.scale
    } else if (drag.kind === 'window') {
      const w = plan.windows[drag.index]
      const ring = ringOf(plan, w.ring)
      const a = ring[w.edge]
      const b = ring[(w.edge + 1) % ring.length]
      const t = clampWindowT(projectOnSegment(eventPoint(e), a, b).t, w.width, Math.hypot(b.x - a.x, b.z - a.z))
      if (t !== null) w.t = t
    } else {
      plan.walls[drag.index][drag.end] = wallPoint(e, plan.walls[drag.index][drag.end === 'a' ? 'b' : 'a'], drag.index).point
    }
    render()
  }

  // --- events ---
  svg.addEventListener('pointerdown', (e) => {
    if (!plan) return
    if (e.button === 1 || (e.button === 0 && spaceDown)) {
      e.preventDefault()
      svg.setPointerCapture(e.pointerId)
      return startPan(e)
    }
    if (e.button !== 0) return
    svg.setPointerCapture(e.pointerId)
    if (tool === 'select') selectDown(e)
    else if (tool === 'outline') outlineClick(e)
    else if (tool === 'wall') wallClick(e)
    else windowClick(e)
  })

  svg.addEventListener('pointermove', (e) => {
    if (!plan) return
    if (drag) return dragMove(e)
    if (tool === 'outline') {
      const snap = snapForOutline(eventPoint(e))
      draft.cursor = snap.point
      draft.snap = snap
    } else if (tool === 'wall') {
      const snap = wallPoint(e, draft.wallStart)
      draft.cursor = snap.point
      draft.snap = snap
    } else return
    render()
  })

  const endDrag = (): void => {
    if (!drag) return
    const d = drag
    drag = null
    root.classList.remove('panning')
    if (d.kind === 'pan') return render()
    if (plan && JSON.stringify(plan) !== JSON.stringify(d.before)) {
      const current = plan
      commit(current, d.before)
    }
  }
  svg.addEventListener('pointerup', endDrag)
  svg.addEventListener('pointercancel', endDrag)

  svg.addEventListener('dblclick', () => {
    if (tool === 'outline' && draft.outline.length >= 3) finishOutline()
  })

  svg.addEventListener('wheel', (e) => {
    e.preventDefault()
    const r = svg.getBoundingClientRect()
    const sx = e.clientX - r.left
    const sy = e.clientY - r.top
    const before = toWorld(sx, sy)
    view.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, view.scale * Math.exp(-e.deltaY * 0.0015)))
    view.cx = before.x - (sx - view.w / 2) / view.scale
    view.cz = before.z - (sy - view.h / 2) / view.scale
    render()
  }, { passive: false })

  svg.addEventListener('auxclick', (e) => e.preventDefault())

  const isTyping = (e: KeyboardEvent): boolean => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
  window.addEventListener('keydown', (e) => {
    if (!visible || isTyping(e)) return
    if (e.code === 'Space') {
      spaceDown = true
      e.preventDefault()
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      undo()
    } else if (e.key === 'Escape') {
      if (draft.outline.length || draft.wallStart) draft = { outline: [] }
      else selection = null
      render()
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      if (tool === 'outline' && draft.outline.length) draft.outline.pop()
      else deleteSelected()
      render()
    }
  })
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') spaceDown = false
  })

  // --- view ---
  function measure(): boolean {
    const r = svg.getBoundingClientRect()
    view.w = r.width
    view.h = r.height
    return r.width > 0 && r.height > 0
  }

  function fit(): void {
    if (!building || !measure()) return
    const xs = building.outer.map((p) => p.x)
    const zs = building.outer.map((p) => p.z)
    const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)]
    // usable area: right of the 280 px panel column, left of the 290 px toolbar column
    const left = Math.min(300, view.w * 0.25)
    const right = Math.min(310, view.w * 0.25)
    const areaW = view.w - left - right
    const areaH = view.h - 100
    view.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min(areaW / Math.max(x1 - x0, 1), areaH / Math.max(z1 - z0, 1)) * 0.85))
    view.cx = (x0 + x1) / 2 - (left + areaW / 2 - view.w / 2) / view.scale
    view.cz = (z0 + z1) / 2
    needsFit = false
  }

  function render(): void {
    if (!visible || !building || !plan) return
    if (!measure()) return
    if (needsFit) fit()
    drawScene(svg, { building, neighbors, plan, view, selection, draft })
    statusText.textContent = message?.text ?? HELP[tool]
    statusLine.dataset.kind = message?.kind ?? 'info'
    updateFloorBox()
    updateProps()
  }

  new ResizeObserver(() => render()).observe(root)

  setTool('select')

  return {
    open(b, n, p) {
      building = b
      neighbors = n
      plan = clone(p)
      history = []
      selection = null
      drag = null
      draft = { outline: [] }
      message = undefined
      needsFit = true
      setTool('select')
      updateProps(true)
    },
    setVisible(v) {
      visible = v
      root.hidden = !v
      if (v) {
        needsFit = needsFit || !view.w
        render()
      }
    },
    getPlan() {
      if (!plan) throw new Error('Plan editor has no plan: call open() first')
      return clone(plan)
    },
  }
}
