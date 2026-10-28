import './style.css'
import { createScene } from './scene'
import { createUI } from './ui'

const sunScene = createScene(document.querySelector<HTMLDivElement>('#app')!)
createUI((sun) => sunScene.update(sun))
