import { describe, expect, it } from 'vitest'
import { potButtonKey } from './plant-card'

describe('the plant card pot button', () => {
  it('names what it puts at the spot', () => {
    expect(potButtonKey(undefined, false)).toBe('plant.putPot')
    expect(potButtonKey('pot', true)).toBe('plant.potPlaced')
    expect(potButtonKey('windowbox', false)).toBe('plant.putWindowBox')
    expect(potButtonKey('windowbox', true)).toBe('plant.windowBoxPlaced')
    expect(potButtonKey('wallpot', false)).toBe('plant.putWallPot')
    expect(potButtonKey('wallpot', true)).toBe('plant.wallPotPlaced')
  })
})
