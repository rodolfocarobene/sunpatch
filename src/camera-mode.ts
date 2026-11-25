import type { View } from './ui'

/** How the scene is seen: straight down with north up, the orbit view, or first person inside the apartment. */
export type CameraMode = 'top' | 'outside' | 'inside'

export const CAMERA_MODES: readonly CameraMode[] = ['top', 'outside', 'inside']

/** Number keys for the switcher; nothing else in the app uses digits. */
export const CAMERA_KEYS: Record<CameraMode, string> = { top: '1', outside: '2', inside: '3' }

/** The switcher shows in every view but the map. */
export const hasCameraSwitch = (view: View): boolean => view !== 'map'

/** What the switcher marks as chosen: the Plan editor is itself a top view, whatever camera the scene keeps. */
export const shownCamera = (view: View, mode: CameraMode): CameraMode => (view === 'plan' ? 'top' : mode)

/** Choosing a camera in a view: the view to show and the camera to keep. In Plan, Top stays in the editor and the others open 3D. */
export function pickCamera(view: View, mode: CameraMode): { view: View; mode: CameraMode } {
  return { view: view === 'plan' && mode !== 'top' ? '3d' : view, mode }
}

/**
 * The camera once a walk started or stopped: a double-click on the floor walks (Inside), and Esc or a rebuilt scene ends
 * it (Outside). A walk that ends because the scene was left (Plan, Map) keeps Inside for the way back.
 */
export function cameraAfterWalk(mode: CameraMode, walking: boolean, inScene: boolean): CameraMode {
  if (walking) return 'inside'
  return inScene && mode === 'inside' ? 'outside' : mode
}

/** The camera for a key press, or undefined for other keys and for keys held with Ctrl, Meta or Alt. */
export function cameraForKey(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): CameraMode | undefined {
  if (e.ctrlKey || e.metaKey || e.altKey) return undefined
  return CAMERA_MODES.find((m) => CAMERA_KEYS[m] === e.key)
}
