import type { Panel } from './plan'
import type { PanelShade } from './panel-shade'
import { createPanelShadeJob, shadeKey, type PanelShadeRequest } from './panel-shade-job'

/**
 * Analyses every panel of the plan, one after another, in a worker of its own (the card's job only follows the
 * selected panel), so the totals line can add them up. Results are cached by the job per (scene, panel, place).
 */
export interface PanelTotals {
  /** Starts or restarts the analysis of `panels`; `onChange` fires as results arrive. */
  update(base: Omit<PanelShadeRequest, 'panel'>, panels: Panel[]): void
  /** Shades of the panels analysed so far, by panel id; a panel being re-analysed keeps its last shade until the new one arrives (see `fresh`). */
  shades(): Map<string, PanelShade>
  /** True when the shade of this panel is the answer for the scene as it is now. */
  fresh(id: string): boolean
  /** True while panels are still waiting for their analysis. */
  busy(): boolean
  dispose(): void
}

export function createPanelTotals(onChange: () => void): PanelTotals {
  const job = createPanelShadeJob()
  let done = new Map<string, { key: string; shade: PanelShade }>()
  /** The last answer per panel, kept while a new one is worked out, so the list does not go blank. */
  const last = new Map<string, PanelShade>()
  let queue: { panel: Panel; base: Omit<PanelShadeRequest, 'panel'> }[] = []
  let current: { id: string; key: string } | undefined

  function next() {
    const item = queue.shift()
    if (!item) {
      current = undefined
      onChange()
      return
    }
    const req = { ...item.base, panel: { ...item.panel } }
    current = { id: item.panel.id, key: shadeKey(req) }
    job.request(req)
  }

  job.onState((state) => {
    if (state.status === 'ready' && current && state.key === current.key) {
      done.set(current.id, { key: current.key, shade: state.shade })
      last.set(current.id, state.shade)
      onChange()
      next()
    } else if (state.status === 'error') {
      queue = []
      current = undefined
      onChange()
    }
  })

  return {
    update(base, panels) {
      const keep = new Map<string, { key: string; shade: PanelShade }>()
      queue = []
      for (const panel of panels) {
        const key = shadeKey({ ...base, panel })
        const hit = done.get(panel.id)
        if (hit && hit.key === key) keep.set(panel.id, hit)
        else queue.push({ panel, base })
      }
      done = keep
      for (const id of [...last.keys()]) if (!panels.some((p) => p.id === id)) last.delete(id)
      job.stop()
      if (queue.length) next()
      else {
        current = undefined
        onChange()
      }
    },
    shades: () => new Map([...last, ...[...done].map(([id, v]) => [id, v.shade] as const)]),
    fresh: (id) => done.has(id),
    busy: () => queue.length > 0 || current !== undefined,
    dispose: () => job.dispose(),
  }
}
