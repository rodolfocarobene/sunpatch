// Lofi radio for the "Lofi" mode: tunes generated live with the Web Audio API, no samples and no streaming.
// The pure parts (tune choice, swung step times, MIDI to Hz, bar length) are exported and tested; the audio graph is not.

/** A chord: a rootless voicing (MIDI notes) plus the bass root. */
interface Chord { name: string; bass: number; notes: number[] }
interface Progression { name: string; chords: Chord[] }

/** A tune is a key shift (semitones from C), a tempo, a swing amount and a 4-chord loop. */
export interface Tune {
  prog: Progression
  shift: number
  bpm: number
  swing: number
  fill: number
}

/** What the UI needs about the current tune: the key as a pitch class (0 = C ... 11 = B) and the tempo. */
export interface TuneInfo { key: number; bpm: number }

export interface LofiPlayer {
  /** Starts (or resumes) the music. The first call creates the AudioContext, so it must come from a user click. */
  play(): Promise<void>
  /** Stops the scheduler and suspends the context. */
  pause(): void
  /** Picks a new tune, at once. */
  next(): void
  /** 0 to 1. */
  setVolume(v: number): void
  /** 0 to 1: the hiss and pops. */
  setVinyl(v: number): void
  isPlaying(): boolean
  /** Calls `cb` now and on every tune change (including the slow drift to new chords). Returns an unsubscribe function. */
  onTune(cb: (info: TuneInfo) => void): () => void
}

export const PROGRESSIONS: Progression[] = [
  { name: 'ii-V-I-vi', chords: [
    { name: 'm9', bass: 38, notes: [53, 57, 60, 64] },
    { name: '13', bass: 43, notes: [53, 57, 59, 64] },
    { name: 'maj9', bass: 36, notes: [52, 55, 59, 62] },
    { name: 'm9', bass: 45, notes: [55, 59, 60, 64] } ] },
  { name: 'IV-iii-ii-I', chords: [
    { name: 'maj9', bass: 41, notes: [57, 60, 64, 67] },
    { name: 'm7', bass: 40, notes: [55, 59, 62, 64] },
    { name: 'm9', bass: 38, notes: [53, 57, 60, 64] },
    { name: 'maj7', bass: 36, notes: [52, 55, 59, 62] } ] },
  { name: 'vi-IV-I-V', chords: [
    { name: 'm9', bass: 45, notes: [55, 59, 60, 64] },
    { name: 'maj7', bass: 41, notes: [57, 60, 64, 65] },
    { name: 'add9', bass: 36, notes: [55, 60, 62, 64] },
    { name: 'sus', bass: 43, notes: [55, 60, 62, 65] } ] },
]
export const KEY_SHIFTS = [-4, -3, -2, 0, 1, 3]
export const BPM_RANGE: [number, number] = [68, 82]
export const SWING_RANGE: [number, number] = [0.56, 0.64]

const LOOKAHEAD = 0.15
const BARS_PER_DRIFT = 32

export const midiToHz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12)

/** Length of one 4/4 bar in seconds. */
export const barSeconds = (bpm: number): number => (4 * 60) / bpm

/** Pitch class (0 = C) of a key shift. */
export const keyOfShift = (shift: number): number => (12 + shift) % 12

const between = (a: number, b: number, random: () => number): number => a + random() * (b - a)
const pickOf = <T>(xs: readonly T[], random: () => number): T => xs[Math.floor(random() * xs.length)]

/** A new random tune. `random` returns [0, 1) and is called in a fixed order: progression, key, tempo, swing, fill. */
export function chooseTune(random: () => number = Math.random): Tune {
  const prog = pickOf(PROGRESSIONS, random)
  const shift = pickOf(KEY_SHIFTS, random)
  return { prog, shift, bpm: Math.round(between(BPM_RANGE[0], BPM_RANGE[1], random)), swing: between(SWING_RANGE[0], SWING_RANGE[1], random), fill: random() }
}

/** Start time of swung eighth `i` (0-7) of a bar that starts at `t0`: even eighths on the beat, odd ones `swing` of a beat later. */
export const stepTime = (t0: number, beat: number, swing: number, i: number): number => t0 + beat * Math.floor(i / 2) + (i % 2 ? swing * beat : 0)

export function createLofiPlayer(): LofiPlayer {
  let ctx: AudioContext | undefined
  let master: GainNode, keysBus: GainNode, drumBus: GainNode, vinylGain: GainNode, wowGain: GainNode
  let noiseBuf: AudioBuffer
  let playing = false
  let run = 0
  let timer: ReturnType<typeof setInterval> | undefined
  let tune = chooseTune()
  let bar = 0
  let nextBarTime = 0
  let volume = 0.6
  let vinyl = 0.5
  const listeners = new Set<(info: TuneInfo) => void>()

  const rand = (a: number, b: number) => between(a, b, Math.random)
  const pick = <T>(xs: readonly T[]) => pickOf(xs, Math.random)
  const info = (): TuneInfo => ({ key: keyOfShift(tune.shift), bpm: tune.bpm })
  const emit = () => listeners.forEach((cb) => cb(info()))

  function newTune() {
    tune = chooseTune()
    bar = 0
    emit()
  }

  function setup(): AudioContext {
    const c = new AudioContext()
    ctx = c
    // Warm master chain: soft saturation, a low-pass that makes it "lofi", then a gentle compressor.
    const shaper = c.createWaveShaper()
    const curve = new Float32Array(1024)
    for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; curve[i] = Math.tanh(1.6 * x) }
    shaper.curve = curve
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200; lp.Q.value = 0.5
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 40
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 3
    master = c.createGain(); master.gain.value = volume
    keysBus = c.createGain(); keysBus.gain.value = 0.5
    drumBus = c.createGain(); drumBus.gain.value = 0.7
    keysBus.connect(shaper); drumBus.connect(shaper)
    shaper.connect(hp).connect(lp).connect(comp).connect(master).connect(c.destination)

    // Tape wow: a slow wobble on the pitch of every tonal voice.
    const wow = c.createOscillator(); wow.frequency.value = 0.45
    wowGain = c.createGain(); wowGain.gain.value = 9 // cents
    wow.connect(wowGain); wow.start()

    noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate)
    const d = noiseBuf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1

    // Vinyl: quiet hiss plus sparse random pops, looped.
    const crackBuf = c.createBuffer(1, c.sampleRate * 4, c.sampleRate)
    const cd = crackBuf.getChannelData(0)
    for (let i = 0; i < cd.length; i++) {
      cd[i] = (Math.random() * 2 - 1) * 0.025
      if (Math.random() < 0.00025) { const amp = rand(0.2, 0.7); for (let k = 0; k < 40 && i + k < cd.length; k++) cd[i + k] += amp * Math.exp(-k / 6) * (Math.random() * 2 - 1) }
    }
    const crackle = c.createBufferSource(); crackle.buffer = crackBuf; crackle.loop = true
    const crackLp = c.createBiquadFilter(); crackLp.type = 'bandpass'; crackLp.frequency.value = 2500; crackLp.Q.value = 0.4
    vinylGain = c.createGain(); vinylGain.gain.value = vinyl * 0.6
    crackle.connect(crackLp).connect(vinylGain).connect(master)
    crackle.start()
    return c
  }

  function epiano(c: AudioContext, midi: number, t: number, dur: number, vel: number) {
    const f = midiToHz(midi)
    const g = c.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.16 * vel, t + 0.015)
    g.gain.exponentialRampToValueAtTime(0.07 * vel, t + 0.4)
    g.gain.setTargetAtTime(0.0001, t + dur, 0.25)
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1700
    for (const [type, detune, level] of [['triangle', -5, 0.7], ['sine', 6, 0.6], ['sine', 1200, 0.08]] as const) {
      const o = c.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = detune
      wowGain.connect(o.detune)
      const og = c.createGain(); og.gain.value = level
      o.connect(og).connect(lp)
      o.start(t); o.stop(t + dur + 1.5)
    }
    lp.connect(g).connect(keysBus)
  }

  function bassNote(c: AudioContext, midi: number, t: number, dur: number) {
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = midiToHz(midi)
    wowGain.connect(o.detune)
    const g = c.createGain()
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.35, t + 0.02)
    g.gain.setTargetAtTime(0.0001, t + dur, 0.08)
    o.connect(g).connect(keysBus); o.start(t); o.stop(t + dur + 0.6)
  }

  function lead(c: AudioContext, midi: number, t: number, dur: number) {
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = midiToHz(midi)
    const vib = c.createOscillator(); vib.frequency.value = 5; const vg = c.createGain(); vg.gain.value = 6
    vib.connect(vg).connect(o.detune); wowGain.connect(o.detune)
    const g = c.createGain()
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06, t + 0.05)
    g.gain.setTargetAtTime(0.0001, t + dur, 0.2)
    o.connect(g).connect(keysBus)
    o.start(t); vib.start(t); o.stop(t + dur + 1); vib.stop(t + dur + 1)
  }

  function noiseHit(c: AudioContext, t: number, type: BiquadFilterType, freq: number, q: number, level: number, decay: number) {
    const s = c.createBufferSource(); s.buffer = noiseBuf
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q
    const g = c.createGain()
    g.gain.setValueAtTime(level, t); g.gain.exponentialRampToValueAtTime(0.0001, t + decay)
    s.connect(f).connect(g).connect(drumBus)
    s.start(t, Math.random()); s.stop(t + decay + 0.05)
  }

  function kick(c: AudioContext, t: number, vel: number) {
    const o = c.createOscillator(); o.type = 'sine'
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12)
    const g = c.createGain()
    g.gain.setValueAtTime(0.9 * vel, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45)
    o.connect(g).connect(drumBus); o.start(t); o.stop(t + 0.5)
  }

  function snare(c: AudioContext, t: number, vel: number) {
    noiseHit(c, t, 'bandpass', 1800, 0.8, 0.35 * vel, 0.22)
    const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = 180
    const g = c.createGain(); g.gain.setValueAtTime(0.12 * vel, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1)
    o.connect(g).connect(drumBus); o.start(t); o.stop(t + 0.15)
  }

  const hat = (c: AudioContext, t: number, vel: number) => noiseHit(c, t, 'highpass', 7000, 0.7, 0.07 * vel, 0.05)

  function scheduleBar(c: AudioContext, t0: number) {
    const beat = 60 / tune.bpm
    const chord = tune.prog.chords[bar % 4]
    const sh = tune.shift
    // Chord: a slow strum, held for the bar, sometimes re-struck on beat 3 and-a.
    chord.notes.forEach((n, i) => epiano(c, n + sh, t0 + i * rand(0.008, 0.02), beat * (Math.random() < 0.3 ? 2.4 : 3.8), rand(0.75, 1)))
    if (Math.random() < 0.35) chord.notes.forEach((n, i) => epiano(c, n + sh, t0 + beat * 2.6 + i * 0.012, beat * 1.2, rand(0.5, 0.7)))
    bassNote(c, chord.bass + sh, t0, beat * 1.6)
    bassNote(c, chord.bass + sh + (Math.random() < 0.3 ? 7 : 0), t0 + beat * 2.5, beat * 1.2)

    // Swung eighths for drums and melody.
    const busy = bar % 8 === 7 && tune.fill > 0.4
    for (let i = 0; i < 8; i++) {
      const t = stepTime(t0, beat, tune.swing, i) + rand(-0.006, 0.006)
      if (i === 0 || i === 4 || (i === 5 && Math.random() < 0.35) || (busy && i === 7)) kick(c, t, i === 0 ? 1 : 0.8)
      if (i === 2 || i === 6) snare(c, t, rand(0.8, 1))
      if (busy && i === 7) snare(c, t, 0.5)
      if (Math.random() < 0.9) hat(c, t, i % 2 ? rand(0.4, 0.7) : rand(0.8, 1))
      if (bar % 4 !== 3 && Math.random() < 0.22) lead(c, pick(chord.notes) + sh + 12, t, beat * rand(0.4, 1.2))
    }
    bar++
    if (bar % BARS_PER_DRIFT === 0) { const keep = tune.bpm; newTune(); tune.bpm = keep; emit() } // drift to new chords, same groove
  }

  function tick() {
    const c = ctx!
    while (nextBarTime < c.currentTime + LOOKAHEAD) {
      scheduleBar(c, nextBarTime)
      nextBarTime += barSeconds(tune.bpm)
    }
  }

  return {
    async play() {
      if (playing) return
      const c = ctx ?? setup()
      playing = true
      const mine = ++run
      await c.resume()
      if (!playing || mine !== run) return
      nextBarTime = c.currentTime + 0.1
      timer = setInterval(tick, 40)
    },
    pause() {
      if (!playing) return
      playing = false
      run++
      clearInterval(timer)
      void ctx?.suspend()
    },
    next() { newTune() },
    setVolume(v) {
      volume = v
      if (master) master.gain.value = v
    },
    setVinyl(v) {
      vinyl = v
      if (vinylGain) vinylGain.gain.value = v * 0.6
    },
    isPlaying: () => playing,
    onTune(cb) {
      listeners.add(cb)
      cb(info())
      return () => void listeners.delete(cb)
    },
  }
}
