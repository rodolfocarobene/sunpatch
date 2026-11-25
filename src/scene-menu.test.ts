import { describe, expect, it } from 'vitest'
import { plantById } from './plants'
import { MENU_FURNITURE, MENU_PLANTS, sceneMenuItems } from './scene-menu'

const out = { hasPlan: true, walking: false }

describe('sceneMenuItems', () => {
  it('offers the light, plants and furniture on the apartment floor', () => {
    expect(sceneMenuItems({ floor: true, spot: 'indoor', building: true }, out)).toEqual([['sun', 'daylight'], ['plants', 'addPlant', 'addFurniture']])
  })

  it('puts the piece first on a piece of furniture, and keeps the floor under it', () => {
    expect(sceneMenuItems({ furniture: true, floor: true }, out)).toEqual([['rotate', 'remove'], ['sun', 'daylight'], ['addFurniture']])
  })

  it('offers plants and the height on a roof, plants only on the ground', () => {
    expect(sceneMenuItems({ spot: 'roof', building: true }, out)).toEqual([['plants', 'addPlant'], ['height']])
    expect(sceneMenuItems({ spot: 'ground' }, out)).toEqual([['plants', 'addPlant']])
  })

  it('offers only the height on a facade', () => {
    expect(sceneMenuItems({ building: true }, out)).toEqual([['height']])
  })

  it('leaves out what needs a plan before one is drawn', () => {
    expect(sceneMenuItems({ spot: 'ground' }, { hasPlan: false, walking: false })).toEqual([['plants']])
    expect(sceneMenuItems({ furniture: true, floor: true, spot: 'indoor' }, { hasPlan: false, walking: false })).toEqual([['plants']])
  })

  it('leaves out the height while walking', () => {
    expect(sceneMenuItems({ building: true, spot: 'roof' }, { hasPlan: true, walking: true })).toEqual([['plants', 'addPlant']])
  })

  it('is empty for the sky', () => {
    expect(sceneMenuItems({}, out)).toEqual([])
  })
})

describe('menu lists', () => {
  it('names plants that grow where the pot stands', () => {
    for (const id of MENU_PLANTS.indoor) expect(plantById(id)?.indoor, id).toBe(true)
    for (const id of MENU_PLANTS.outdoor) expect(plantById(id)?.outdoor, id).toBe(true)
  })

  it('places every furniture kind but the plain plant', () => {
    expect(MENU_FURNITURE).toContain('sofa')
    expect(MENU_FURNITURE).not.toContain('plant')
  })
})
