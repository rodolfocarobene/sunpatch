import {
  AmbientLight,
  ArrowHelper,
  BoxGeometry,
  Color,
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
import type { SunDirection } from './sun'

const GROUND_SIZE = 200
const SUN_DISTANCE = 150
const SHADOW_EXTENT = 70
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
  dispose(): void
}

function addBox(scene: Scene, spec: number[], color: number): Mesh {
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

  const camera = new PerspectiveCamera(50, 1, 0.5, 1000)
  camera.position.set(35, 30, 55)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.set(0, 4, 0)
  controls.maxPolarAngle = Math.PI / 2 - 0.02
  controls.update()

  const ground = new Mesh(
    new PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
    new MeshStandardMaterial({ color: 0x7a8f6a }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  scene.add(ground)

  addBox(scene, HOUSE, 0xe6d9c3)
  // 3 floors: thin dark bands at 3 m and 6 m make the storeys readable.
  for (const y of [3, 6]) {
    const band = new Mesh(
      new BoxGeometry(HOUSE[2] + 0.1, 0.15, HOUSE[3] + 0.1),
      new MeshStandardMaterial({ color: 0x6b5d4a }),
    )
    band.position.set(HOUSE[0], y, HOUSE[1])
    scene.add(band)
  }
  for (const n of NEIGHBORS) addBox(scene, n, 0xb8b8c0)

  // North arrow on the ground (north = -z), placed beside the buildings.
  const arrow = new ArrowHelper(new Vector3(0, 0, -1), new Vector3(35, 0.05, 30), 14, 0xd23030, 4, 3)
  scene.add(arrow)

  const hemi = new HemisphereLight(0xcfe3ff, 0x5a6a4a, 0.35)
  const ambient = new AmbientLight(0xffffff, 0.05)
  scene.add(hemi, ambient)

  const sunLight = new DirectionalLight(0xfff4e0, 3)
  sunLight.castShadow = true
  sunLight.shadow.mapSize.set(4096, 4096)
  const cam = sunLight.shadow.camera
  cam.left = -SHADOW_EXTENT
  cam.right = SHADOW_EXTENT
  cam.top = SHADOW_EXTENT
  cam.bottom = -SHADOW_EXTENT
  cam.near = 1
  cam.far = SUN_DISTANCE * 2
  sunLight.shadow.bias = -0.0005
  sunLight.shadow.normalBias = 0.05
  sunLight.target.position.set(0, 0, 0)
  scene.add(sunLight, sunLight.target)

  function resize() {
    const { clientWidth: w, clientHeight: h } = container
    renderer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  window.addEventListener('resize', resize)
  resize()

  renderer.setAnimationLoop(() => {
    controls.update()
    renderer.render(scene, camera)
  })

  return {
    update(sun) {
      const { x, y, z } = sun.vector
      sunLight.position.set(x, y, z).multiplyScalar(SUN_DISTANCE).add(sunLight.target.position)
      const up = sun.altitudeDeg > 0
      sunLight.visible = up
      // Fade the sky and fill light through twilight (0 to -6 deg) rather than snapping.
      const t = Math.min(1, Math.max(0, (sun.altitudeDeg + 6) / 6))
      scene.background = SKY_NIGHT.clone().lerp(SKY_DAY, t)
      hemi.intensity = 0.05 + 0.3 * t
      sunLight.intensity = 3 * Math.min(1, sun.altitudeDeg / 5)
    },
    dispose() {
      renderer.setAnimationLoop(null)
      window.removeEventListener('resize', resize)
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}
