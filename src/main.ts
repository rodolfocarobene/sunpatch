import './style.css'
import { createScene } from './scene'
import { sunDirection } from './sun'

const container = document.querySelector<HTMLDivElement>('#app')!
const sunScene = createScene(container)
sunScene.update(sunDirection(new Date(), 45.4642, 9.19))
