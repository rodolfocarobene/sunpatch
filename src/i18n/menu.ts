import { defineStrings } from './define'

/** The scene's context menu (right-click, or a long press on a touch screen) and the Plan editor's. */
export const menu = defineStrings({
  en: {
    'menu.aria': 'Actions here',
    'menu.back': 'Back',
    'menu.sun': 'Sun here',
    'menu.daylight': 'Indirect light here (estimate)',
    'menu.plants': 'Plants for this spot',
    'menu.addPlant': 'Add a plant here',
    'menu.choosePlant': 'Choose…',
    'menu.addFurniture': 'Add furniture here',
    'menu.height': 'Set height…',
    'menu.rotate': 'Rotate 90°',
    'menu.remove': 'Remove',
    'menu.added': '{name} added.',
    'menu.removed': '{name} removed.',
    'menu.rotated': '{name} turned.',
  },
  it: {
    'menu.aria': 'Azioni qui',
    'menu.back': 'Indietro',
    'menu.sun': 'Sole qui',
    'menu.daylight': 'Luce indiretta qui (stima)',
    'menu.plants': 'Piante per questo punto',
    'menu.addPlant': 'Aggiungi una pianta qui',
    'menu.choosePlant': 'Scegli…',
    'menu.addFurniture': 'Aggiungi un mobile qui',
    'menu.height': 'Imposta altezza…',
    'menu.rotate': 'Ruota di 90°',
    'menu.remove': 'Rimuovi',
    'menu.added': 'Aggiunto: {name}.',
    'menu.removed': 'Rimosso: {name}.',
    'menu.rotated': 'Ruotato: {name}.',
  },
})
