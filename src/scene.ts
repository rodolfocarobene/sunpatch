import {
  AmbientLight,
  ArrowHelper,
  BoxGeometry,
  Color,
  Group,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { buildingGeometry } from './footprint'
import { hiddenOutlines, partsOf, ringCentroid, type Building } from './osm'
import type { SunDirection } from './sun'

// Test scene: 200 m ground. Real data (250 m radius): ground ~700 m, shadows cover the radius.
const TEST_EXTENT = { ground: 200, shadow: 70, sunDistance: 150 }
const DATA_EXTENT = { ground: 700, shadow: 280, sunDistance: 500 }
const SELECTED_COLOR = 0xe8a15a
const OTHER_COLOR = 0xb8b8c0
const SKY_DAY = new Color(0x9ec9ee)
const SKY_NIGHT = new Color(0x0b1020)

// Boxes: [centre x (east), centre z (south), width (x), depth (z), height]; metres.
const HOUSE: [number, number, number, number, number] = [0, 0, 10, 9, 9]
const NEIGHBORS: [number, number, number, number, number][] = [
  [-18, 2, 12, 10, 15],
  [17, -4, 9, 14, 6],
  [2, -22, 16, 8, 12],
]

export interface SunScene {
  update(sun: SunDirection): void
  /** Replaces the scene content; the selected building should be centred on the origin. */
  setBuildings(buildings: Building[], selectedId: string): void
  resize(): void
  /** Pauses rendering while the 3D view is hidden. */
  setActive(active: boolean): void
  dispose(): void
}

function addBox(scene: Group, spec: number[], color: number): Mesh {
  const [x, z, w, d, h] = spec
  const mesh = new Mesh(new BoxGeometry(w, h, d), new MeshStandardMaterial({ color }))
  mesh.position.set(x, h / 2, z)
  mesh.castShadow = true
  mesh.receiveShadow = true
  scene.add(mesh)
  return mesh
}

export function createScene(container: HTMLElement): SunScene {
  const renderer = new WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = PCFSoftShadowMap
  container.appendChild(renderer.domElement)

  const scene = new Scene()
  scene.background = SKY_DAY.clone()

  const camera = new PerspectiveCamera(50, 1, 0.5, 3000)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.maxPolarAngle = Math.PI / 2 - 0.02

  function frame(position: Vector3, target: Vector3) {
    camera.position.copy(position)
    controls.target.copy(target)
    controls.update()
  }
  frame(new Vector3(35, 30, 55), new Vector3(0, 4, 0))

  const ground = new Mesh(new PlaneGeometry(1, 1), new MeshStandardMaterial({ color: 0x7a8f6a }))
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  scene.add(ground)

  const world = new Group()
  scene.add(world)

  const hemi = new HemisphereLight(0xcfe3ff, 0x5a6a4a, 0.35)
  const ambient = new AmbientLight(0xffffff, 0.05)
  scene.add(hemi, ambient)

  const sunLight = new DirectionalLight(0xfff4e0, 3)
  sunLight.castShadow = true
  sunLight.shadow.mapSize.set(4096, 4096)
  sunLight.shadow.camera.near = 1
  sunLight.shadow.bias = -0.0005
  sunLight.shadow.normalBias = 0.05
  sunLight.target.position.set(0, 0, 0)
  scene.add(sunLight, sunLight.target)

  let sunDistance = TEST_EXTENT.sunDistance
  let lastSun: SunDirection | undefined

  function update(sun: SunDirection) {
    lastSun = sun
    const { x, y, z } = sun.vector
    sunLight.position.set(x, y, z).multiplyScalar(sunDistance).add(sunLight.target.position)
    sunLight.visible = sun.altitudeDeg > 0
    // Fade the sky and fill light through twilight (0 to -6 deg) rather than snapping.
    const t = Math.min(1, Math.max(0, (sun.altitudeDeg + 6) / 6))
    scene.background = SKY_NIGHT.clone().lerp(SKY_DAY, t)
    hemi.intensity = 0.05 + 0.3 * t
    sunLight.intensity = 3 * Math.min(1, sun.altitudeDeg / 5)
  }

  function setExtent(e: typeof TEST_EXTENT) {
    ground.scale.set(e.ground, e.ground, 1)
    const c = sunLight.shadow.camera
    c.left = c.bottom = -e.shadow
    c.right = c.top = e.shadow
    c.far = e.sunDistance * 2
    c.updateProjectionMatrix()
    sunDistance = e.sunDistance
    if (lastSun) update(lastSun)
  }

  function clearWorld() {
    for (const child of world.children) {
      if (child instanceof Mesh) {
        child.geometry.dispose()
        child.material.dispose()
      }
    }
    world.clear()
  }

  // North arrow on the ground (north = -z), placed beside the buildings.
  function addNorthArrow(x: number, z: number) {
    world.add(new ArrowHelper(new Vector3(0, 0, -1), new Vector3(x, 0.05, z), 14, 0xd23030, 4, 3))
  }

  function buildTestScene() {
    addBox(world, HOUSE, 0xe6d9c3)
    // 3 floors: thin dark bands at 3 m and 6 m make the storeys readable.
    for (const y of [3, 6]) {
      const band = new Mesh(
        new BoxGeometry(HOUSE[2] + 0.1, 0.15, HOUSE[3] + 0.1),
        new MeshStandardMaterial({ color: 0x6b5d4a }),
      )
      band.position.set(HOUSE[0], y, HOUSE[1])
      world.add(band)
    }
    for (const n of NEIGHBORS) addBox(world, n, 0xb8b8c0)
    addNorthArrow(35, 30)
  }

  clearWorld()
  setExtent(TEST_EXTENT)
  buildTestScene()

  function setBuildings(buildings: Building[], selectedId: string) {
    clearWorld()
    setExtent(DATA_EXTENT)
    const selected = buildings.find((b) => b.id === selectedId)
    const hidden = hiddenOutlines(buildings)
    const highlighted = new Set([selectedId])
    if (selected && hidden.has(selected.id)) {
      for (const p of partsOf(selected, buildings)) highlighted.add(p.id)
    }
    for (const b of buildings) {
      if (hidden.has(b.id)) continue
      const isSelected = highlighted.has(b.id)
      const mesh = new Mesh(
        buildingGeometry(b),
        new MeshStandardMaterial({ color: isSelected ? SELECTED_COLOR : OTHER_COLOR }),
      )
      mesh.castShadow = true
      mesh.receiveShadow = true
      world.add(mesh)
    }
    if (!selected) return
    const c = ringCentroid(selected.outer)
    let half = 5
    for (const p of selected.outer) half = Math.max(half, Math.abs(p.x - c.x), Math.abs(p.z - c.z))
    const dist = Math.max(40, half * 3 + selected.height)
    frame(
      new Vector3(c.x + dist * 0.6, selected.height / 2 + dist * 0.5, c.z + dist * 0.8),
      new Vector3(c.x, selected.height / 2, c.z),
    )
    addNorthArrow(c.x + half + 15, c.z + half + 15)
  }

  function resize() {
    const { clientWidth: w, clientHeight: h } = container
    if (!w || !h) return
    renderer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  window.addEventListener('resize', resize)
  resize()

  function render() {
    controls.update()
    renderer.render(scene, camera)
  }
  renderer.setAnimationLoop(render)

  return {
    update,
    setBuildings,
    resize,
    setActive(active) {
      renderer.setAnimationLoop(active ? render : null)
    },
    dispose() {
      renderer.setAnimationLoop(null)
      window.removeEventListener('resize', resize)
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}
