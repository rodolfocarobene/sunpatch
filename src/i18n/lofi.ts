import { defineStrings } from './define'

/** Lofi mode: the toggle in the panel header and the mini-player. */
export const lofi = defineStrings({
  en: {
    'lofi.toggle': 'Lofi',
    'lofi.toggleTitle': 'Lofi mode: generated music, made live in your browser',
    'lofi.player': 'Lofi player',
    'lofi.play': 'Play',
    'lofi.pause': 'Pause',
    'lofi.next': 'Next tune',
    'lofi.volume': 'Volume',
    'lofi.tune': '{key} major · {bpm} bpm',
  },
  it: {
    'lofi.toggle': 'Lofi',
    'lofi.toggleTitle': 'Modalità lofi: musica generata dal vivo nel browser',
    'lofi.player': 'Lettore lofi',
    'lofi.play': 'Riproduci',
    'lofi.pause': 'Pausa',
    'lofi.next': 'Altro brano',
    'lofi.volume': 'Volume',
    'lofi.tune': '{key} maggiore · {bpm} bpm',
  },
})
