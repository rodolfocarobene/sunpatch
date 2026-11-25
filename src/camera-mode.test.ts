import { describe, expect, it } from 'vitest'
import { CAMERA_KEYS, cameraAfterWalk, cameraForKey, hasCameraSwitch, pickCamera, shownCamera } from './camera-mode'

describe('pickCamera', () => {
  it('keeps the view in 3D, Panels and Garden', () => {
    expect(pickCamera('3d', 'top')).toEqual({ view: '3d', mode: 'top' })
    expect(pickCamera('garden', 'inside')).toEqual({ view: 'garden', mode: 'inside' })
    expect(pickCamera('panels', 'outside')).toEqual({ view: 'panels', mode: 'outside' })
  })

  it('stays in Plan for Top and opens 3D for the others', () => {
    expect(pickCamera('plan', 'top')).toEqual({ view: 'plan', mode: 'top' })
    expect(pickCamera('plan', 'outside')).toEqual({ view: '3d', mode: 'outside' })
    expect(pickCamera('plan', 'inside')).toEqual({ view: '3d', mode: 'inside' })
  })
})

describe('shownCamera', () => {
  it('shows Top in Plan and the kept camera elsewhere', () => {
    expect(shownCamera('plan', 'inside')).toBe('top')
    expect(shownCamera('garden', 'inside')).toBe('inside')
    expect(shownCamera('3d', 'outside')).toBe('outside')
  })

  it('is on every view but the map', () => {
    expect(hasCameraSwitch('map')).toBe(false)
    expect(['plan', '3d', 'panels', 'garden'].every((v) => hasCameraSwitch(v as never))).toBe(true)
  })
})

describe('cameraAfterWalk', () => {
  it('is Inside once a walk starts, whatever came before', () => {
    expect(cameraAfterWalk('top', true, true)).toBe('inside')
    expect(cameraAfterWalk('outside', true, true)).toBe('inside')
  })

  it('goes Outside when the walk ends in the scene (Esc, exit, rebuild)', () => {
    expect(cameraAfterWalk('inside', false, true)).toBe('outside')
  })

  it('keeps the camera the walk was left for, and Inside when the scene is left', () => {
    expect(cameraAfterWalk('top', false, true)).toBe('top')
    expect(cameraAfterWalk('inside', false, false)).toBe('inside')
  })
})

describe('cameraForKey', () => {
  it('maps 1, 2 and 3', () => {
    expect(cameraForKey({ key: '1' })).toBe('top')
    expect(cameraForKey({ key: '2' })).toBe('outside')
    expect(cameraForKey({ key: '3' })).toBe('inside')
  })

  it('ignores other keys and modified presses', () => {
    expect(cameraForKey({ key: '4' })).toBeUndefined()
    expect(cameraForKey({ key: 'w' })).toBeUndefined()
    expect(cameraForKey({ key: '1', ctrlKey: true })).toBeUndefined()
    expect(cameraForKey({ key: '2', altKey: true })).toBeUndefined()
  })

  it('uses a distinct key per camera', () => {
    const keys = Object.values(CAMERA_KEYS)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
