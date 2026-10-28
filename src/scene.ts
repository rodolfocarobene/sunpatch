import {
  AmbientLight,
  ArrowHelper,
  BoxGeometry,
  Color,
  DoubleSide,
  Group,
  DirectionalLight,
  HemisphereLight,
  BufferGeometry,
  Mesh,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { apartmentGeometry } from './apartment'
import { buildingGeometry } from './footprint'
import { hiddenOutlines, partsOf, ringCentroid, type Building } from './osm'
import { floorBase, type Plan } from './plan'
import type { SunDirection } from './sun'

// Test scene: 200 m ground. Real data (250 m radius): ground ~700 m, shadows cover the radius.
const TEST_EXTENT = { ground: 200, shadow: 70, sunDistance: 150 }
const DATA_EXTENT = { ground: 700, shadow: 280, sunDistance: 500 }
const SELECTED_COLOR = 0xe8a15a
const OTHER_COLOR = 0xb8b8c0
const FLOOR_COLOR = 0xd8cfc0
const WALL_COLOR = 0xf2efe9
const GLASS_COLOR = 0x9ecfe8
const APARTMENT_SHADOW_MAP = 2048
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
  /** Replaces the scene content; the selected building should be centred on the origin. keepCamera leaves the view as is. */
  setBuildings(buildings: Building[], selectedId: string, options?: { keepCamera?: boolean }): void
  /** Replaces the selected building by the building with this apartment carved out; null restores it. */
  setPlan(plan: Plan | null): void
  /** Hides the part of the selected building above the apartment's ceiling from the camera (it still casts shadows). */
  setCutaway(on: boolean): void
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
  renderer.shadowMap.type = PCFShadowMap
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
  // Just below y = 0 so a ground-floor apartment's floor does not z-fight with it.
  ground.position.y = -0.05
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

  // Narrow copy of the sun for the apartment: its shadow map covers only the selected building but
  // reaches the whole way to the sun, so neighbours still shade it. render() lights the apartment with
  // this one and everything else with sunLight, never both on the same surface.
  const aptLight = new DirectionalLight(0xfff4e0, 3)
  aptLight.castShadow = true
  aptLight.visible = false
  aptLight.shadow.mapSize.set(APARTMENT_SHADOW_MAP, APARTMENT_SHADOW_MAP)
  aptLight.shadow.camera.near = 1
  aptLight.shadow.bias = -0.0003
  aptLight.shadow.normalBias = 0.02
  scene.add(aptLight, aptLight.target)

  let sunDistance = TEST_EXTENT.sunDistance
  let lastSun: SunDirection | undefined
  let sunUp = true

  function update(sun: SunDirection) {
    lastSun = sun
    const { x, y, z } = sun.vector
    sunLight.position.set(x, y, z).multiplyScalar(sunDistance).add(sunLight.target.position)
    aptLight.position.set(x, y, z).multiplyScalar(sunDistance).add(aptLight.target.position)
    sunUp = sun.altitudeDeg > 0
    sunLight.visible = sunUp
    // Fade the sky and fill light through twilight (0 to -6 deg) rather than snapping.
    const t = Math.min(1, Math.max(0, (sun.altitudeDeg + 6) / 6))
    scene.background = SKY_NIGHT.clone().lerp(SKY_DAY, t)
    hemi.intensity = 0.05 + 0.3 * t
    sunLight.intensity = aptLight.intensity = 3 * Math.min(1, sun.altitudeDeg / 5)
  }

  function setExtent(e: typeof TEST_EXTENT) {
    ground.scale.set(e.ground, e.ground, 1)
    const c = sunLight.shadow.camera
    c.left = c.bottom = -e.shadow
    c.right = c.top = e.shadow
    c.far = aptLight.shadow.camera.far = e.sunDistance * 2
    c.updateProjectionMatrix()
    aptLight.shadow.camera.updateProjectionMatrix()
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

  let buildings: Building[] = []
  let selectedId = ''
  let plan: Plan | null = null
  let cutaway = false
  let apartmentMeshes = new Set<Mesh>()
  let glassMeshes: Mesh[] = []
  let ceilingMaterial: MeshStandardMaterial | undefined

  function apartmentMesh(geometry: BufferGeometry, material: MeshStandardMaterial): Mesh {
    const mesh = new Mesh(geometry, material)
    mesh.castShadow = true
    mesh.receiveShadow = true
    apartmentMeshes.add(mesh)
    world.add(mesh)
    return mesh
  }

  function addApartment(b: Building, p: Plan) {
    const g = apartmentGeometry(b, p)
    const shellMaterial = new MeshStandardMaterial({ color: SELECTED_COLOR })
    ceilingMaterial = new MeshStandardMaterial({ color: SELECTED_COLOR })
    const floorMaterial = new MeshStandardMaterial({ color: FLOOR_COLOR })
    const wallMaterial = new MeshStandardMaterial({ color: WALL_COLOR })
    const glassMaterial = new MeshStandardMaterial({
      color: GLASS_COLOR, transparent: true, opacity: 0.15, depthWrite: false, side: DoubleSide,
    })
    for (const geometry of g.shell) apartmentMesh(geometry, shellMaterial)
    for (const geometry of g.ceiling) apartmentMesh(geometry, ceilingMaterial)
    apartmentMesh(g.floor, floorMaterial)
    for (const geometry of g.walls) apartmentMesh(geometry, wallMaterial)
    glassMeshes = g.glass.map((geometry) => {
      const mesh = new Mesh(geometry, glassMaterial)
      world.add(mesh)
      return mesh
    })
    applyCutaway()
  }

  function applyCutaway() {
    if (!ceilingMaterial) return
    // Still drawn into the shadow map (the depth pass ignores the material), but invisible to the camera.
    ceilingMaterial.colorWrite = ceilingMaterial.depthWrite = !cutaway
  }

  function apartmentBounds(b: Building, p: Plan) {
    const c = ringCentroid(p.outline.outer)
    let radius = 5
    for (const q of [...b.outer, ...p.outline.outer]) radius = Math.max(radius, Math.hypot(q.x - c.x, q.z - c.z))
    return { c, radius }
  }

  function populate() {
    clearWorld()
    apartmentMeshes = new Set()
    glassMeshes = []
    ceilingMaterial = undefined
    const selected = buildings.find((b) => b.id === selectedId)
    const hidden = hiddenOutlines(buildings)
    const highlighted = new Set([selectedId])
    if (selected && hidden.has(selected.id)) {
      for (const p of partsOf(selected, buildings)) highlighted.add(p.id)
    }
    for (const b of buildings) {
      if (hidden.has(b.id)) continue
      const isSelected = highlighted.has(b.id)
      if (isSelected && plan) continue
      const mesh = new Mesh(
        buildingGeometry(b),
        new MeshStandardMaterial({ color: isSelected ? SELECTED_COLOR : OTHER_COLOR }),
      )
      mesh.castShadow = true
      mesh.receiveShadow = true
      world.add(mesh)
    }
    if (!selected) return
    if (plan) {
      addApartment(selected, plan)
      const { c, radius } = apartmentBounds(selected, plan)
      const mid = floorBase(selected, plan) + plan.floorHeight / 2
      aptLight.target.position.set(c.x, mid, c.z)
      const cam = aptLight.shadow.camera
      cam.left = cam.bottom = -(radius + 5)
      cam.right = cam.top = radius + 5
      cam.updateProjectionMatrix()
      if (lastSun) update(lastSun)
    }
    const c = ringCentroid(selected.outer)
    let half = 5
    for (const p of selected.outer) half = Math.max(half, Math.abs(p.x - c.x), Math.abs(p.z - c.z))
    addNorthArrow(c.x + half + 15, c.z + half + 15)
  }

  function frameBuilding(b: Building) {
    const c = ringCentroid(b.outer)
    let half = 5
    for (const p of b.outer) half = Math.max(half, Math.abs(p.x - c.x), Math.abs(p.z - c.z))
    const dist = Math.max(40, half * 3 + b.height)
    frame(
      new Vector3(c.x + dist * 0.6, b.height / 2 + dist * 0.5, c.z + dist * 0.8),
      new Vector3(c.x, b.height / 2, c.z),
    )
  }

  // From above at ~45 degrees, on the side opposite the windows so they are seen from inside.
  function frameApartment(b: Building, p: Plan) {
    const { c, radius } = apartmentBounds(b, p)
    const out = new Vector3()
    for (const w of p.windows) {
      const ring = w.ring === 0 ? p.outline.outer : p.outline.holes[w.ring - 1]
      const a = ring[w.edge]
      const q = ring[(w.edge + 1) % ring.length]
      const normal = new Vector3(q.z - a.z, 0, a.x - q.x).normalize()
      const mid = new Vector3((a.x + q.x) / 2 - c.x, 0, (a.z + q.z) / 2 - c.z)
      out.addScaledVector(normal, Math.sign(normal.dot(mid)) || 1)
    }
    const side = out.lengthSq() > 1e-6 ? out.normalize().negate() : new Vector3(0, 0, 1)
    const target = new Vector3(c.x, floorBase(b, p) + 1, c.z)
    const dist = radius * 3 + 6
    frame(target.clone().addScaledVector(side, dist * 0.7).setY(target.y + dist * 0.7), target)
  }

  function setBuildings(next: Building[], id: string, { keepCamera = false } = {}) {
    setExtent(DATA_EXTENT)
    buildings = next
    selectedId = id
    if (plan?.buildingId !== id || !next.some((b) => b.id === id)) plan = null
    populate()
    const selected = next.find((b) => b.id === id)
    if (selected && !keepCamera) frameBuilding(selected)
  }

  function setPlan(next: Plan | null) {
    const selected = buildings.find((b) => b.id === selectedId)
    const accepted = next && selected && next.buildingId === selected.id ? next : null
    const first = accepted && !plan
    plan = accepted
    populate()
    if (accepted && selected && first) {
      cutaway = true
      applyCutaway()
      frameApartment(selected, accepted)
    }
  }

  function setCutaway(on: boolean) {
    cutaway = on
    applyCutaway()
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

  // Pass 2 of the two-light render: everything outside the apartment is drawn without colour or
  // depth (it only has to stay in the narrow shadow map) over the first pass's picture.
  function renderApartmentPass() {
    const hidden = new Map<object, { colorWrite: boolean; depthWrite: boolean }>()
    scene.traverse((o) => {
      if (!(o instanceof Mesh) || apartmentMeshes.has(o) || glassMeshes.includes(o)) return
      for (const m of [o.material].flat()) hidden.set(m, { colorWrite: m.colorWrite, depthWrite: m.depthWrite })
    })
    for (const m of hidden.keys() as Iterable<MeshStandardMaterial>) m.colorWrite = m.depthWrite = false
    for (const g of glassMeshes) g.visible = true
    sunLight.visible = false
    aptLight.visible = true
    // A colour background clears the frame even with autoClear off, so take it away for this pass.
    const background = scene.background
    scene.background = null
    renderer.autoClear = false
    renderer.render(scene, camera)
    renderer.autoClear = true
    scene.background = background
    aptLight.visible = false
    sunLight.visible = true
    for (const [m, state] of hidden as Map<MeshStandardMaterial, { colorWrite: boolean; depthWrite: boolean }>) {
      m.colorWrite = state.colorWrite
      m.depthWrite = state.depthWrite
    }
  }

  function render() {
    controls.update()
    const twoPass = plan !== null && sunUp
    for (const g of glassMeshes) g.visible = !twoPass
    renderer.render(scene, camera)
    if (twoPass) renderApartmentPass()
    for (const g of glassMeshes) g.visible = true
  }
  renderer.setAnimationLoop(render)

  return {
    update,
    setBuildings,
    setPlan,
    setCutaway,
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
