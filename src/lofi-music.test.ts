import { describe, expect, it } from 'vitest'
import { BPM_RANGE, barSeconds, chooseTune, keyOfShift, KEY_SHIFTS, midiToHz, PROGRESSIONS, stepTime, SWING_RANGE } from './lofi-music'

/** A random source that returns the given values in turn. */
const seq = (...values: number[]) => {
  let i = 0
  return () => values[i++ % values.length]
}

describe('midiToHz', () => {
  it('maps A4 to 440 Hz and doubles per octave', () => {
    expect(midiToHz(69)).toBeCloseTo(440, 6)
    expect(midiToHz(81)).toBeCloseTo(880, 6)
    expect(midiToHz(57)).toBeCloseTo(220, 6)
    expect(midiToHz(60)).toBeCloseTo(261.626, 3)
  })
})

describe('barSeconds', () => {
  it('is four beats of the tempo', () => {
    expect(barSeconds(60)).toBe(4)
    expect(barSeconds(120)).toBe(2)
    expect(barSeconds(75)).toBeCloseTo(3.2, 9)
  })
})

describe('stepTime', () => {
  const beat = 0.8
  it('puts even eighths on the beat and odd ones a swing fraction of a beat later', () => {
    expect(stepTime(10, beat, 0.6, 0)).toBeCloseTo(10, 9)
    expect(stepTime(10, beat, 0.6, 1)).toBeCloseTo(10 + 0.6 * beat, 9)
    expect(stepTime(10, beat, 0.6, 2)).toBeCloseTo(10 + beat, 9)
    expect(stepTime(10, beat, 0.6, 3)).toBeCloseTo(10 + beat + 0.6 * beat, 9)
    expect(stepTime(10, beat, 0.6, 7)).toBeCloseTo(10 + 3 * beat + 0.6 * beat, 9)
  })
  it('is straight eighths at swing 0.5', () => {
    expect(stepTime(0, 1, 0.5, 1)).toBe(0.5)
  })
})

describe('keyOfShift', () => {
  it('wraps the shift to a pitch class', () => {
    expect(keyOfShift(0)).toBe(0)
    expect(keyOfShift(3)).toBe(3)
    expect(keyOfShift(-4)).toBe(8)
  })
})

describe('chooseTune', () => {
  it('uses the random source in a fixed order and maps it into the ranges', () => {
    const tune = chooseTune(seq(0, 0, 0, 0, 0))
    expect(tune.prog).toBe(PROGRESSIONS[0])
    expect(tune.shift).toBe(KEY_SHIFTS[0])
    expect(tune.bpm).toBe(BPM_RANGE[0])
    expect(tune.swing).toBeCloseTo(SWING_RANGE[0], 9)
    expect(tune.fill).toBe(0)
    const top = chooseTune(seq(0.999, 0.999, 0.999, 0.999, 0.999))
    expect(top.prog).toBe(PROGRESSIONS[PROGRESSIONS.length - 1])
    expect(top.shift).toBe(KEY_SHIFTS[KEY_SHIFTS.length - 1])
    expect(top.bpm).toBe(BPM_RANGE[1])
    expect(top.swing).toBeLessThan(SWING_RANGE[1])
  })
  it('stays inside the ranges for any random value', () => {
    for (let i = 0; i < 200; i++) {
      const tune = chooseTune()
      expect(PROGRESSIONS).toContain(tune.prog)
      expect(KEY_SHIFTS).toContain(tune.shift)
      expect(tune.bpm).toBeGreaterThanOrEqual(BPM_RANGE[0])
      expect(tune.bpm).toBeLessThanOrEqual(BPM_RANGE[1])
      expect(tune.swing).toBeGreaterThanOrEqual(SWING_RANGE[0])
      expect(tune.swing).toBeLessThan(SWING_RANGE[1])
    }
  })
})
