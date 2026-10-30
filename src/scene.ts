import {
  ACESFilmicToneMapping,
  AmbientLight,
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  DataTexture,
  LinearFilter,
  RGBAFormat,
  RingGeometry,
  Shape,
  ShapeGeometry,
  SRGBColorSpace,
  Path,
  Float32BufferAttribute,
  MeshBasicMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  DoubleSide,
  FrontSide,
  EdgesGeometry,
  LineBasicMaterial,
  LineSegments,
  Group,
  type Intersection,
  DirectionalLight,
  HemisphereLight,
  BufferGeometry,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import { isClick } from './click'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { apartmentGeometry } from './apartment'
import { ribbonsData } from './ribbon'
import { buildingGeometry } from './footprint'
import { panelMeshes } from './panel-mesh'
import { hiddenOutlines, partsOf, pickBuilding, ringCentroid, type Building } from './osm'
import { SLAB_THICKNESS, floorBase, type Plan } from './plan'
import type { SunDirection } from './sun'
import { createWalkControls, type WalkHandlers } from './walk'
import { insideOutline, walkStart } from './walk-geom'
import { collectOccluders } from './sunmap-trace'
import { heatTexels, type Grid } from './sunmap'
import { along, facing } from './panel'
import type { SurfaceSample } from './suitability'
import { POT_HEIGHT } from './garden-spots'
import { CELL_SIZE, STEP_COLORS, type FindKind, type Step } from './garden-find'
import { hatchedMaterial, hatchStrength } from './hatch'
import { isGuessed } from './heights'
import { buildTreeGroup, disposeTreeGroup, type Tree } from './trees'

// Test scene: 200 m ground. Real data (250 m radius): ground ~700 m, shadows cover the radius.
const TEST_EXTENT = { ground: 200, shadow: 70, sunDistance: 150 }
const DATA_EXTENT = { ground: 700, shadow: 280, sunDistance: 500 }
// Warm plaster and stone; amber is kept for the apartment outline and the sun patches.
const SELECTED_COLOR = 0xdac8a6
// Added volume (plan edits): a lighter shade of the building colour, so a fix reads as a fix.
const ADDED_COLOR = 0xecd6aa
const OTHER_COLOR = 0xc9c1b4
const FLOOR_COLOR = 0xc9a77a
const WALL_COLOR = 0xf7eddd
const CEILING_COLOR = 0xd0def2
const EDGE_COLOR = 0x2b2b30
const EDGE_OPACITY = 0.75
const EDGE_ANGLE_DEG = 25
const GLASS_COLOR = 0x9ecfe8
const GROUND_COLOR = 0x8a9880
// The app's --accent and --accent-strong: the apartment outline along its wall tops, and its ghost when the floors above are shown.
const OUTLINE_COLOR = 0xf5a623
const OUTLINE_GHOST_COLOR = 0xb45f06
const OUTLINE_GHOST_OPACITY = 0.8
// Above the wall tops, which are flush with the rest of the storey.
const OUTLINE_LIFT = 0.03
// About 4 px on screen at the usual orbit distance (a 0.16 m ribbon came out at 2 px); the same as the facade wall it sits on.
const OUTLINE_WIDTH = 0.3
// Hover cue on a building that a click would switch to (the amber of the outline, kept faint).
const HOVER_OPACITY = 0.28
const HOVER_EDGE_OPACITY = 0.9
const APARTMENT_SHADOW_MAP = 2048
// Sun map overlay: a hair above the floor (the floor slab's top is the floor height), see-through enough that the
// live sun patches still show faintly, and fainter again in first person where it would hide them.
const SUNMAP_LIFT = 0.012
const SUNMAP_OPACITY = 0.8
const SUNMAP_WALK_OPACITY = 0.55
// Panel suitability overlay: coloured quads a hand's width off the surface they describe (facade quads stand out from
// the wall, roof and ground quads lie flat above it), a gap between neighbours so cells read as cells.
const SUIT_LIFT = 0.08
const SUIT_GAP = 0.08
const SUIT_OPACITY = 0.92
// Plant map (Garden view): flat quads just above the surface under each spot, a little see-through so the ground still reads.
const GARDEN_MAP_LIFT = 0.06
const GARDEN_MAP_GAP = 0.06
const GARDEN_MAP_OPACITY = 0.78
const PROBE_COLOR = 0x1f2a37
const PROBE_RING = 0xfffdf8
const SKY_DAY = new Color(0x8fbfe8)
const SKY_NIGHT = new Color(0x0b1020)
const SKY_HORIZON_DAY = new Color(0xf1ece0)
const SKY_HORIZON_NIGHT = new Color(0x141b30)
// The sun is drawn along its direction at this distance from the camera (inside far, in front of the sky dome).
const SKY_RADIUS = 2000
const SUN_DISTANCE = 1700
// Exaggerated so it can be noticed (the real sun is 0.53 deg); the glow sprite is GLOW_RATIO times wider than the core.
const SUN_DISC_DEG = 2.5
const GLOW_RATIO = 5
const SUN_WHITE = new Color(0xfff6dc)
const SUN_LOW = new Color(0xff9a45)
// Stand-in for indirect light: the apartment surfaces glow by this fraction of their colour in daylight.
const INTERIOR_GLOW = 0.18
const ORBIT_FOV = 50
const ORBIT_NEAR = 0.5
const WALK_FOV = 70
const WALK_NEAR = 0.05

// Boxes: [centre x (east), centre z (south), width (x), depth (z), height]; metres.
const HOUSE: [number, number, number, number, number] = [0, 0, 10, 9, 9]
const NEIGHBORS: [number, number, number, number, number][] = [
  [-18, 2, 12, 10, 15],
  [17, -4, 9, 14, 6],
  [2, -22, 16, 8, 12],
]

/** What a Garden click found: the point on the surface, whether it is the apartment floor, and which way the surface faces. */
export interface GardenHit {
  x: number
  y: number
  z: number
  apartmentFloor: boolean
  normalY: number
  /** The floors above are hidden and this is the cut through the selected building, not its roof. */
  cut?: boolean
}

export interface SunScene {
  update(sun: SunDirection): void
  /** Replaces the scene content; the selected building should be centred on the origin. keepCamera leaves the view as is. */
  setBuildings(buildings: Building[], selected: Building | string, options?: { keepCamera?: boolean }): void
  /** Replaces the selected building by the building with this apartment carved out and the plan edits applied; null restores it. */
  setPlan(plan: Plan | null, options?: { close?: boolean; keepView?: boolean }): void
  /** Replaces the trees (local metres, same origin as the buildings); an empty list removes them. */
  setTrees(trees: Tree[]): void
  /** Hides the part of the selected building above the apartment's ceiling from the camera (it still casts shadows). */
  setCutaway(on: boolean): void
  /** Enters first person in the apartment at scene point `at` (default: the plan's viewpoint, else a clear spot near the middle); false without a plan. */
  startWalk(at?: { x: number; z: number }): boolean
  stopWalk(): void
  /** Called when walk mode starts or stops (also by double-click on the floor, Esc, or a view change) and for its keys. */
  setWalkHandlers(handlers: WalkHandlers & { change(walking: boolean): void }): void
  resize(): void
  /** Called with the id of the building polygon under a shift-click (not a drag) in the 3D view. */
  onPartClick(handler: (polygonId: string) => void): void
  /** Shows or hides the stripes on buildings whose height is a guess (on by default); the shapes and shadows are unchanged. */
  setMarkGuessed(on: boolean): void
  /** Called as the pointer moves over a building polygon (selected or not) with where it is on screen, and with null when it leaves. */
  onBuildingHover(handler: (polygon: Building | null, at: { x: number; y: number }) => void): void
  /** Called with the polygon under a right-click (not a drag): its id and where it is on screen. */
  onBuildingMenu(handler: (polygonId: string, at: { x: number; y: number }) => void): void
  /** Called with a plain click (not a drag) on a building that is not selected: its polygon id and the scene point hit. */
  onBuildingClick(handler: (polygonId: string, at: { x: number; z: number }) => void): void
  /** Called with the id of the panel under a plain click (not a drag) in 3D, or null for a click on anything else. */
  onPanelClick(handler: (id: string | null) => void): void
  /** Pauses rendering while the 3D view is hidden. */
  setActive(active: boolean): void
  /** Changes whenever anything that can shade the apartment is rebuilt (buildings, plan, edits) or replaced (trees). */
  sceneVersion(): number
  /** Triangles (nine numbers each) of everything that casts a shadow, for the sun map's rays. */
  occluders(): Float32Array
  /** Called after the scene content changed; the sun map is stale then. */
  onSceneChange(handler: () => void): void
  /** Paints the sun map on the apartment floor; null removes it. */
  setSunMap(map: { grid: Grid; minutes: Float32Array } | null): void
  /** Shows or hides the painted sun map (also in first person). */
  setSunMapVisible(on: boolean): void
  /** Paints the panel suitability map: one quad per sample, coloured by `colors` (sRGB 0..1, three numbers each); null removes it. */
  setSuitability(map: { samples: SurfaceSample[]; colors: Float32Array } | null): void
  /** Shows or hides the map (it is hidden in first person). While it shows, the floors above the apartment stay visible so the facade and roof have something behind them. */
  setSuitabilityVisible(on: boolean): void
  /** Outlines one sample of the map (null removes it); the handler gets where it is on screen. */
  setSuitabilityMark(index: number | null): void
  onSuitabilityScreen(handler: (at: { x: number; y: number; visible: boolean } | null) => void): void
  /** Called with the index of the sample under a plain click (not a drag) while the map shows, or null for a click anywhere else. */
  onSuitabilityClick(handler: (index: number | null) => void): void
  /** While the map shows: whether the selected building is in view; the handler hears each change. The camera is never moved for the map. */
  onBuildingInView(handler: (inView: boolean) => void): void
  /** Frames the whole selected building (the legend's "Frame the building"). */
  frameSelected(): void
  /** Marks a floor point of the sun map (null removes the mark); the handler gets where it is on screen, or null when gone. */
  setProbe(at: { x: number; z: number } | null): void
  onProbeScreen(handler: (at: { x: number; y: number; visible: boolean } | null) => void): void
  /** Called with the floor point of a plain click (not a drag) while the sun map shows or while walking, or null for a click anywhere else. */
  onFloorClick(handler: (at: { x: number; z: number } | null) => void): void
  /** Turns the Garden view's picking on or off: while on, a plain click (not a drag) reports the surface the camera sees there. */
  setGardenPicking(on: boolean): void
  /** Called with the surface under a plain click while picking (null for the sky); `normalY` is the surface normal's height component. */
  onGardenClick(handler: (hit: GardenHit | null) => void): void
  /** Marks a spot of the Garden view on the surface (`y` is the surface height); null removes the mark. */
  setGardenMark(at: { x: number; y: number; z: number } | null): void
  /** Paints the plant map: one flat quad per spot of step good or ok (`y` is the pot's height; quads lie on the surface below it); null removes it. */
  setGardenMap(map: { spots: { x: number; y: number; z: number; kind: FindKind; cell?: number }[]; steps: Step[] } | null): void
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

/** Inverted sphere around the camera, lighter toward the horizon; colours set by `paint`. */
function createSky() {
  const geometry = new SphereGeometry(SKY_RADIUS, 24, 12)
  const position = geometry.getAttribute('position')
  const colours = new Float32BufferAttribute(position.count * 3, 3)
  geometry.setAttribute('color', colours)
  const mesh = new Mesh(
    geometry,
    new MeshBasicMaterial({ vertexColors: true, side: BackSide, depthWrite: false, depthTest: false, toneMapped: false, fog: false }),
  )
  mesh.renderOrder = -10
  const horizon = new Color()
  const zenith = new Color()
  const c = new Color()
  return {
    mesh,
    paint(daylight: number) {
      zenith.copy(SKY_NIGHT).lerp(SKY_DAY, daylight)
      horizon.copy(SKY_HORIZON_NIGHT).lerp(SKY_HORIZON_DAY, daylight)
      for (let i = 0; i < position.count; i++) {
        // Above the horizon blend to the zenith colour (quickly: the sky is light only near the ground); below it stays at horizon.
        const t = Math.min(1, Math.max(0, position.getY(i) / SKY_RADIUS)) ** 0.6
        c.copy(horizon).lerp(zenith, t)
        colours.setXYZ(i, c.r, c.g, c.b)
      }
      colours.needsUpdate = true
    },
  }
}

function glowTexture(): CanvasTexture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const g = canvas.getContext('2d')!
  const half = size / 2
  const core = 1 / GLOW_RATIO
  const gradient = g.createRadialGradient(half, half, 0, half, half, half)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(core * 0.9, 'rgba(255,255,255,1)')
  gradient.addColorStop(core * 1.25, 'rgba(255,255,255,0.35)')
  gradient.addColorStop(core * 2.5, 'rgba(255,255,255,0.1)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = gradient
  g.fillRect(0, 0, size, size)
  return new CanvasTexture(canvas)
}

/** The sun as a glowing disc: a sprite the scene keeps on the sun's direction, occluded by solid geometry. */
function createSunDisc(): Sprite {
  const sprite = new Sprite(
    new SpriteMaterial({
      map: glowTexture(), blending: AdditiveBlending, depthWrite: false, depthTest: true, toneMapped: false, fog: false,
    }),
  )
  const angle = (SUN_DISC_DEG * GLOW_RATIO * Math.PI) / 180
  const size = 2 * SUN_DISTANCE * Math.tan(angle / 2)
  sprite.scale.set(size, size, 1)
  sprite.renderOrder = 2
  sprite.visible = false
  return sprite
}

export function createScene(container: HTMLElement): SunScene {
  const renderer = new WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = PCFShadowMap
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.3
  container.appendChild(renderer.domElement)

  const scene = new Scene()
  scene.background = SKY_DAY.clone()

  const sky = createSky()
  const sunDisc = createSunDisc()
  scene.add(sky.mesh, sunDisc)

  const camera = new PerspectiveCamera(ORBIT_FOV, 1, ORBIT_NEAR, 3000)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.maxPolarAngle = Math.PI / 2 - 0.02

  function frame(position: Vector3, target: Vector3) {
    camera.position.copy(position)
    controls.target.copy(target)
    controls.update()
  }
  frame(new Vector3(35, 30, 55), new Vector3(0, 4, 0))

  const ground = new Mesh(new PlaneGeometry(1, 1), new MeshStandardMaterial({ color: GROUND_COLOR }))
  ground.rotation.x = -Math.PI / 2
  // Just below y = 0 so a ground-floor apartment's floor does not z-fight with it.
  ground.position.y = -0.05
  ground.receiveShadow = true
  scene.add(ground)

  const world = new Group()
  scene.add(world)
  // Trees live outside `world`: they depend on the OSM answer, not on the plan, and populate() must not drop them.
  let treeGroup = new Group()
  scene.add(treeGroup)

  const hemi = new HemisphereLight(0xdfe9f5, 0x7d8a6c, 0.35)
  const ambient = new AmbientLight(0xfff3e0, 0.12)
  scene.add(hemi, ambient)

  const sunLight = new DirectionalLight(0xfff4e0, 3)
  sunLight.castShadow = true
  sunLight.shadow.mapSize.set(4096, 4096)
  sunLight.shadow.camera.near = 1
  sunLight.shadow.bias = -0.0005
  sunLight.shadow.normalBias = 0.08
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
  aptLight.shadow.bias = -0.0004
  aptLight.shadow.normalBias = 0.05
  scene.add(aptLight, aptLight.target)

  let sunDistance = TEST_EXTENT.sunDistance
  let lastSun: SunDirection | undefined
  let sunUp = true
  let daylight = 1

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
    sky.paint(t)
    sunDisc.material.color.copy(SUN_LOW).lerp(SUN_WHITE, Math.min(1, Math.max(0, (sun.altitudeDeg - 2) / 10)))
    daylight = t
    applyGlow()
    hemi.intensity = 0.07 + 0.55 * t
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
      if (child instanceof Mesh || child instanceof LineSegments) {
        child.geometry.dispose()
        child.material.dispose()
      }
    }
    world.clear()
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
  }

  clearWorld()
  setExtent(TEST_EXTENT)
  buildTestScene()

  let buildings: Building[] = []
  let selectedId = ''
  let selectedBuilding: Building | undefined
  let plan: Plan | null = null
  let cutaway = false
  let apartmentMeshes = new Set<Mesh>()
  let glassMeshes: Mesh[] = []
  let aptLines: { line: Object3D; kind: 'edge' | 'ceiling' | 'outline' | 'ghost' | 'sunmap' | 'suit' | 'garden' | 'gardenmap' | 'gardenroof' }[] = []
  let ceilingMaterial: MeshStandardMaterial | undefined
  let addedAboveMaterial: MeshStandardMaterial | undefined
  let glowMaterials: MeshStandardMaterial[] = []
  let floorMesh: Mesh | undefined
  let solidMeshes: Mesh[] = []
  let selectedIds = new Set<string>()
  // Sun map: the overlay painted on the floor, the marker of the clicked point, and the version the job caches by.
  let version = 0
  let sceneChange: (() => void) | undefined
  let sunMapOn = false
  let sunMapData: { grid: Grid; minutes: Float32Array } | null = null
  let overlay: Mesh | undefined
  let probe: { x: number; z: number } | null = null
  let probeMark: Group | undefined
  let probeHandler: ((at: { x: number; y: number; visible: boolean } | null) => void) | undefined
  let probeShown = ''
  // Garden view: whether clicks pick a spot, and the marker on it.
  let gardenPicking = false
  let gardenAt: { x: number; y: number; z: number } | null = null
  let gardenMark: Group | undefined
  let gardenClick: ((hit: GardenHit | null) => void) | undefined
  let gardenMapMeshes: Mesh[] = []
  // Panel suitability: the data (kept across rebuilds of the scene), its quads and the outline of the chosen one.
  let suitOn = false
  let suitData: { samples: SurfaceSample[]; colors: Float32Array } | null = null
  let suitMesh: Mesh | undefined
  let suitMark: Group | undefined
  let suitIndex: number | null = null
  let suitHandler: ((at: { x: number; y: number; visible: boolean } | null) => void) | undefined
  let suitShown = ''

  // Faces sit a hair behind their own edge lines so the lines do not flicker.
  function offsetFaces<T extends MeshStandardMaterial>(material: T): T {
    material.polygonOffset = true
    material.polygonOffsetFactor = material.polygonOffsetUnits = 1
    return material
  }

  function apartmentMesh(geometry: BufferGeometry, material: MeshStandardMaterial, edges?: LineBasicMaterial): Mesh {
    if (edges) {
      const line = new LineSegments(new EdgesGeometry(geometry, EDGE_ANGLE_DEG), edges)
      line.renderOrder = 1
      aptLines.push({ line, kind: material === ceilingMaterial ? 'ceiling' : 'edge' })
      world.add(line)
    }
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
    ceilingMaterial = offsetFaces(new MeshStandardMaterial({ color: SELECTED_COLOR }))
    const floorMaterial = offsetFaces(new MeshStandardMaterial({ color: FLOOR_COLOR }))
    const wallMaterial = offsetFaces(new MeshStandardMaterial({ color: WALL_COLOR }))
    // Drawn on top of the faces without writing depth; render() places them in the right pass.
    const edges = new LineBasicMaterial({ color: EDGE_COLOR, transparent: true, opacity: EDGE_OPACITY, depthWrite: false })
    const glassMaterial = new MeshStandardMaterial({
      color: GLASS_COLOR, transparent: true, opacity: 0.15, depthWrite: false, side: DoubleSide,
    })
    for (const geometry of g.shell) apartmentMesh(geometry, shellMaterial)
    for (const geometry of g.ceiling) apartmentMesh(geometry, ceilingMaterial, edges)
    const addedMaterial = new MeshStandardMaterial({ color: ADDED_COLOR })
    addedAboveMaterial = new MeshStandardMaterial({ color: ADDED_COLOR })
    for (const geometry of g.added) apartmentMesh(geometry, addedMaterial)
    for (const geometry of g.addedAbove) apartmentMesh(geometry, addedAboveMaterial)
    floorMesh = apartmentMesh(g.floor, floorMaterial, edges)
    const wallMeshes = g.walls.map((geometry) => apartmentMesh(geometry, wallMaterial, edges))
    solidMeshes = [floorMesh, ...wallMeshes]
    glowMaterials = [floorMaterial, wallMaterial]
    for (const m of glowMaterials) m.emissive.copy(m.color)
    applyGlow()
    glassMeshes = g.glass.map((geometry) => {
      const mesh = new Mesh(geometry, glassMaterial)
      world.add(mesh)
      return mesh
    })
    addOutline(b, p)
    applyCutaway()
  }

  // Amber ribbon along the top of the apartment walls, so the apartment is findable (a 1 px line
  // vanished at normal distances). A faint copy ignores depth, so it still shows through the floors
  // above when they are not hidden. Built once per plan.
  function addOutline(b: Building, p: Plan) {
    const y = floorBase(b, p) + p.floorHeight - SLAB_THICKNESS + OUTLINE_LIFT
    const { positions, indices } = ribbonsData([p.outline.outer, ...p.outline.holes], y, OUTLINE_WIDTH)
    const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(positions, 3))
    geometry.setIndex(indices)
    // Flat colour, not lit or tone-mapped, so it stays the app's amber.
    const flat = { side: DoubleSide, depthWrite: false, toneMapped: false } as const
    // transparent (opacity 1) only to sort after the dark edge lines of the walls instead of under them.
    const solid = new Mesh(geometry, new MeshBasicMaterial({ ...flat, color: OUTLINE_COLOR, transparent: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }))
    const ghost = new Mesh(
      geometry.clone(),
      new MeshBasicMaterial({ ...flat, color: OUTLINE_GHOST_COLOR, transparent: true, opacity: OUTLINE_GHOST_OPACITY, depthTest: false }),
    )
    solid.renderOrder = 2
    ghost.renderOrder = 3
    aptLines.push({ line: solid, kind: 'outline' }, { line: ghost, kind: 'ghost' })
    world.add(solid, ghost)
  }

  function applyGlow() {
    for (const m of glowMaterials) m.emissiveIntensity = INTERIOR_GLOW * daylight
    if (ceilingMaterial) {
      // Seen from inside the block above is the ceiling: paint it as a ceiling; outside it keeps the building colour.
      const colour = walking ? CEILING_COLOR : SELECTED_COLOR
      ceilingMaterial.color.set(colour)
      ceilingMaterial.emissive.set(walking ? CEILING_COLOR : 0x000000)
      ceilingMaterial.emissiveIntensity = INTERIOR_GLOW * daylight
    }
  }

  /** The floors above are hidden only when asked for and the suitability map is not showing (it needs the whole building). */
  const cutawayNow = (): boolean => cutaway && !(suitOn && !walking)

  function applyCutaway() {
    // Still drawn into the shadow map (the depth pass ignores the material), but invisible to the camera.
    // The same in walk mode: with the floors above hidden the ceiling is open to the sky, and the sun still
    // comes in only through the windows because the hidden block keeps casting into the apartment.
    // Its shadow is recorded from its sun-facing side while hidden: by default the map holds the back faces, so
    // the slab's underside sits exactly at the wall tops and the top of the storey, and the normal bias lets the
    // sun leak along them. The top of the block is metres away, so nothing under it can leak. Drawn, the block
    // keeps the default, which is what stops its own roof from acne.
    for (const m of [ceilingMaterial, addedAboveMaterial]) {
      if (!m) continue
      m.colorWrite = m.depthWrite = !cutawayNow()
      m.shadowSide = cutawayNow() ? FrontSide : null
    }
  }

  /** Edge lines of the apartment; the ceiling's follow the ceiling (hidden by cutaway), the ghost outline shows when the floors above are not hidden. */
  function showAptLines(on: boolean) {
    for (const { line, kind } of aptLines) {
      const shown =
        kind === 'ceiling' ? !cutawayNow() : kind === 'ghost' ? !cutawayNow() && !walking : kind === 'outline' ? !walking : kind === 'sunmap' ? sunMapOn : kind === 'suit' ? suitOn && !walking : kind === 'gardenroof' ? !cutawayNow() : true
      line.visible = on && shown
    }
  }

  function apartmentBounds(b: Building, p: Plan, tight = false) {
    const c = ringCentroid(p.outline.outer)
    let radius = 5
    for (const q of tight ? p.outline.outer : [...b.outer, ...p.outline.outer]) radius = Math.max(radius, Math.hypot(q.x - c.x, q.z - c.z))
    return { c, radius }
  }

  const flat = (color: number, geometry: BufferGeometry) =>
    new Mesh(geometry, new MeshBasicMaterial({ color, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }))

  function applyOverlayOpacity() {
    if (overlay) (overlay.material as MeshBasicMaterial).opacity = walking ? SUNMAP_WALK_OPACITY : SUNMAP_OPACITY
  }

  // The floor outline as one flat mesh textured with the sun map (one texel per grid cell, smoothly filtered), a
  // hair above the floor. It is an apartment line (aptLines) so the two-pass render draws it in the second pass,
  // over the floor that pass repaints.
  function paintSunMap() {
    if (overlay) {
      world.remove(overlay)
      aptLines = aptLines.filter((l) => l.line !== overlay)
      overlay.geometry.dispose()
      ;(overlay.material as MeshBasicMaterial).map?.dispose()
      ;(overlay.material as MeshBasicMaterial).dispose()
      overlay = undefined
    }
    if (!sunMapData || !plan || !selectedBuilding) return
    const { grid, minutes } = sunMapData
    const texture = new DataTexture(heatTexels(grid, minutes), grid.cols, grid.rows, RGBAFormat)
    texture.colorSpace = SRGBColorSpace
    texture.magFilter = texture.minFilter = LinearFilter
    texture.generateMipmaps = false
    texture.needsUpdate = true
    const ring = (r: { x: number; z: number }[]) => r.map((p) => new Vector2(p.x, -p.z))
    const shape = new Shape(ring(plan.outline.outer))
    for (const hole of plan.outline.holes) shape.holes.push(new Path(ring(hole)))
    const geometry = new ShapeGeometry(shape)
    geometry.rotateX(-Math.PI / 2)
    const position = geometry.getAttribute('position')
    const uv = new Float32Array(position.count * 2)
    for (let i = 0; i < position.count; i++) {
      uv[i * 2] = (position.getX(i) - grid.minX) / (grid.cols * grid.cell)
      uv[i * 2 + 1] = (position.getZ(i) - grid.minZ) / (grid.rows * grid.cell)
    }
    geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2))
    overlay = new Mesh(
      geometry,
      new MeshBasicMaterial({
        map: texture, transparent: true, depthWrite: false, toneMapped: false, side: DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      }),
    )
    overlay.position.y = floorBase(selectedBuilding, plan) + SUNMAP_LIFT
    applyOverlayOpacity()
    world.add(overlay)
    aptLines.push({ line: overlay, kind: 'sunmap' })
  }

  // A small target on the clicked spot: a dark ring inside a light one, readable on every colour of the ramp.
  function paintProbe() {
    if (probeMark) {
      world.remove(probeMark)
      aptLines = aptLines.filter((l) => l.line.parent !== probeMark)
      for (const child of probeMark.children) {
        const mesh = child as Mesh
        mesh.geometry.dispose()
        ;(mesh.material as MeshBasicMaterial).dispose()
      }
      probeMark = undefined
    }
    probeShown = ''
    if (!probe || !plan || !selectedBuilding) return
    const flatRing = (inner: number, outer: number, color: number) => flat(color, new RingGeometry(inner, outer, 32).rotateX(-Math.PI / 2))
    probeMark = new Group()
    probeMark.add(flatRing(0.17, 0.25, PROBE_RING), flatRing(0.1, 0.17, PROBE_COLOR), flat(PROBE_COLOR, new CircleGeometry(0.045, 16).rotateX(-Math.PI / 2)))
    probeMark.position.set(probe.x, floorBase(selectedBuilding, plan) + SUNMAP_LIFT + 0.004, probe.z)
    probeMark.renderOrder = 1
    for (const child of probeMark.children) child.renderOrder = 1
    world.add(probeMark)
    // Each ring is itself an apartment line: the second pass leaves those meshes drawn, not the group around them.
    for (const child of probeMark.children) aptLines.push({ line: child, kind: 'sunmap' })
  }

  function removeGardenMap() {
    for (const m of gardenMapMeshes) world.remove(m)
    aptLines = aptLines.filter((l) => !gardenMapMeshes.includes(l.line as Mesh))
    gardenMapMeshes.forEach((m) => disposeMeshes(m))
    gardenMapMeshes = []
  }

  // One mesh per kind of spot (the roof's hides with the floors above it hidden, or it would hang in the air).
  function paintGardenMap(map: { spots: { x: number; y: number; z: number; kind: FindKind; cell?: number }[]; steps: Step[] } | null) {
    removeGardenMap()
    if (!map) return
    for (const kind of ['indoor', 'ground', 'roof'] as const) {
      const idx = map.spots.map((s, i) => (s.kind === kind && map.steps[i] > 0 ? i : -1)).filter((i) => i >= 0)
      if (idx.length === 0) continue
      const positions = new Float32Array(idx.length * 12)
      const colors = new Float32Array(idx.length * 12)
      const index = new Uint32Array(idx.length * 6)
      const c = new Color()
      idx.forEach((si, n) => {
        const { x, y, z, cell } = map.spots[si]
        const h = (cell ?? CELL_SIZE[kind]) / 2 - GARDEN_MAP_GAP / 2
        const top = y - POT_HEIGHT + GARDEN_MAP_LIFT
        positions.set([[-1, -1], [1, -1], [1, 1], [-1, 1]].flatMap(([u, v]) => [x + h * u, top, z + h * v]), n * 12)
        c.setHex(STEP_COLORS[map.steps[si] as 1 | 2], SRGBColorSpace)
        for (let k = 0; k < 4; k++) colors.set([c.r, c.g, c.b], n * 12 + k * 3)
        index.set([0, 1, 2, 0, 2, 3].map((k) => n * 4 + k), n * 6)
      })
      const geometry = new BufferGeometry()
      geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
      geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
      geometry.setIndex(new BufferAttribute(index, 1))
      const mesh = new Mesh(
        geometry,
        new MeshBasicMaterial({
          vertexColors: true, transparent: true, opacity: GARDEN_MAP_OPACITY, depthWrite: false, toneMapped: false, side: DoubleSide,
          polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
        }),
      )
      mesh.raycast = () => {} // a click goes through to the surface below, which names the spot
      world.add(mesh)
      gardenMapMeshes.push(mesh)
      aptLines.push({ line: mesh, kind: kind === 'roof' ? 'gardenroof' : 'gardenmap' })
    }
    applyCutaway()
  }

  // The Garden view's spot: the probe's two rings, on the ground, a roof or the floor; scaled with the distance so it can be found from afar.
  function paintGardenMark() {
    if (gardenMark) {
      world.remove(gardenMark)
      aptLines = aptLines.filter((l) => l.line.parent !== gardenMark)
      for (const child of gardenMark.children) {
        const mesh = child as Mesh
        mesh.geometry.dispose()
        ;(mesh.material as MeshBasicMaterial).dispose()
      }
      gardenMark = undefined
    }
    if (!gardenAt) return
    const flatRing = (inner: number, outer: number, color: number) => flat(color, new RingGeometry(inner, outer, 32).rotateX(-Math.PI / 2))
    gardenMark = new Group()
    gardenMark.add(flatRing(0.17, 0.25, PROBE_RING), flatRing(0.1, 0.17, PROBE_COLOR), flat(PROBE_COLOR, new CircleGeometry(0.045, 16).rotateX(-Math.PI / 2)))
    gardenMark.position.set(gardenAt.x, gardenAt.y + 0.03, gardenAt.z)
    for (const child of gardenMark.children) {
      child.renderOrder = 1
      aptLines.push({ line: child, kind: 'garden' })
    }
    world.add(gardenMark)
  }

  // Where the marked point is on screen, so a popover can follow it while the camera moves.
  const probeScreen = new Vector3()
  function reportProbe() {
    if (!probeHandler) return
    if (!probeMark || !selectedBuilding || !plan) {
      if (probeShown) probeHandler(null)
      probeShown = ''
      return
    }
    probeScreen.copy(probeMark.position).project(camera)
    const rect = renderer.domElement.getBoundingClientRect()
    const x = Math.round((probeScreen.x * 0.5 + 0.5) * rect.width + rect.left)
    const y = Math.round((-probeScreen.y * 0.5 + 0.5) * rect.height + rect.top)
    const visible = probeScreen.z < 1 && Math.abs(probeScreen.x) <= 1 && Math.abs(probeScreen.y) <= 1
    const key = `${x} ${y} ${visible}`
    if (key === probeShown) return
    probeShown = key
    probeHandler({ x, y, visible })
  }

  // One quad per sample, vertex-coloured, as an apartment line so the second render pass draws it over the walls it
  // sits on. Facade quads are vertical (their normal is the sample's facing), the others flat.
  function suitCorners(q: SurfaceSample): number[] {
    const h = q.size / 2 - SUIT_GAP / 2
    if (q.kind === 'facade') {
      const n = facing(q.azimuth)
      const r = along(q.azimuth)
      const at = { x: q.x + n.x * SUIT_LIFT, z: q.z + n.z * SUIT_LIFT }
      return [-1, 1, 1, -1].flatMap((u, i) => [at.x + r.x * h * u, q.y + h * (i < 2 ? -1 : 1), at.z + r.z * h * u])
    }
    const y = q.y + SUIT_LIFT
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].flatMap(([u, v]) => [q.x + h * u, y, q.z + h * v])
  }

  function disposeMeshes(root: Object3D | undefined) {
    root?.traverse((o) => {
      const mesh = o as Mesh
      if (!mesh.isMesh) return
      mesh.geometry.dispose()
      ;(mesh.material as MeshBasicMaterial).dispose()
    })
  }

  function removeSuitability() {
    for (const o of [suitMesh, suitMark]) if (o) world.remove(o)
    aptLines = aptLines.filter((l) => l.line !== suitMesh && l.line.parent !== suitMark)
    disposeMeshes(suitMesh)
    disposeMeshes(suitMark)
    suitMesh = suitMark = undefined
    suitShown = ''
  }

  function paintSuitability() {
    removeSuitability()
    if (!suitData) return
    const { samples, colors } = suitData
    const positions = new Float32Array(samples.length * 12)
    const linear = new Float32Array(samples.length * 12)
    const index = new Uint32Array(samples.length * 6)
    const c = new Color()
    samples.forEach((q, i) => {
      positions.set(suitCorners(q), i * 12)
      c.setRGB(colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2], SRGBColorSpace)
      for (let k = 0; k < 4; k++) linear.set([c.r, c.g, c.b], i * 12 + k * 3)
      index.set([0, 1, 2, 0, 2, 3].map((k) => i * 4 + k), i * 6)
    })
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
    geometry.setAttribute('color', new Float32BufferAttribute(linear, 3))
    geometry.setIndex(new BufferAttribute(index, 1))
    suitMesh = new Mesh(
      geometry,
      new MeshBasicMaterial({
        vertexColors: true, transparent: true, opacity: SUIT_OPACITY, depthWrite: false, toneMapped: false, side: DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      }),
    )
    // Clicks on it are answered by its own picking (see the click handler), not by the general ones that look through overlays.
    suitMesh.raycast = () => {}
    world.add(suitMesh)
    aptLines.push({ line: suitMesh, kind: 'suit' })
    paintSuitMark()
  }

  // A dark ring around a light one on the chosen quad, readable on every colour of the ramp.
  function paintSuitMark() {
    if (suitMark) {
      world.remove(suitMark)
      aptLines = aptLines.filter((l) => l.line.parent !== suitMark)
      disposeMeshes(suitMark)
      suitMark = undefined
    }
    suitShown = ''
    if (suitIndex === null || !suitData?.samples[suitIndex]) return
    const corners = suitCorners(suitData.samples[suitIndex])
    const mid = [0, 1, 2].map((k) => (corners[k] + corners[3 + k] + corners[6 + k] + corners[9 + k]) / 4)
    // From far away a 1 m cell is a few pixels: the ring grows with the distance so it stays findable.
    const grow = Math.min(10, Math.max(1, camera.position.distanceTo(new Vector3(mid[0], mid[1], mid[2])) / 25))
    const ring = (outer: number, inner: number, color: number) => {
      const pos: number[] = []
      for (const k of [outer * grow, inner * grow]) for (let v = 0; v < 4; v++) for (let d = 0; d < 3; d++) pos.push(mid[d] + (corners[v * 3 + d] - mid[d]) * k)
      const idx: number[] = []
      for (let v = 0; v < 4; v++) idx.push(v, (v + 1) % 4, 4 + v, (v + 1) % 4, 4 + ((v + 1) % 4), 4 + v)
      const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(pos, 3))
      geometry.setIndex(idx)
      const mesh = new Mesh(geometry, new MeshBasicMaterial({ color, side: DoubleSide, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }))
      mesh.renderOrder = 1
      mesh.raycast = () => {}
      return mesh
    }
    suitMark = new Group()
    suitMark.add(ring(1.22, 1.02, PROBE_COLOR), ring(1.02, 0.84, PROBE_RING))
    suitMark.userData.centre = mid
    world.add(suitMark)
    for (const child of suitMark.children) aptLines.push({ line: child, kind: 'suit' })
  }

  // Where the chosen quad is on screen, so its popover can follow while the camera moves.
  // Whether the building is in view: its middle is on screen and the camera is not much farther than the framing distance.
  let viewHandler: ((inView: boolean) => void) | undefined
  let viewShown: boolean | undefined
  const viewPoint = new Vector3()
  function reportBuildingView() {
    if (!viewHandler) return
    let inView = true
    if (suitOn && !walking && selectedBuilding) {
      const { c, dist } = buildingFraming(selectedBuilding)
      viewPoint.set(c.x, selectedBuilding.height / 2, c.z)
      const far = camera.position.distanceTo(viewPoint) > dist * 3
      viewPoint.project(camera)
      inView = !far && viewPoint.z < 1 && Math.abs(viewPoint.x) < 0.9 && Math.abs(viewPoint.y) < 0.9
    }
    if (inView === viewShown) return
    viewShown = inView
    viewHandler(inView)
  }

  const suitScreen = new Vector3()
  function reportSuitMark() {
    if (!suitHandler) return
    if (!suitMark) {
      if (suitShown) suitHandler(null)
      suitShown = ''
      return
    }
    const [x0, y0, z0] = suitMark.userData.centre as number[]
    suitScreen.set(x0, y0, z0).project(camera)
    const rect = renderer.domElement.getBoundingClientRect()
    const x = Math.round((suitScreen.x * 0.5 + 0.5) * rect.width + rect.left)
    const y = Math.round((-suitScreen.y * 0.5 + 0.5) * rect.height + rect.top)
    const visible = suitScreen.z < 1 && Math.abs(suitScreen.x) <= 1 && Math.abs(suitScreen.y) <= 1
    const key = `${x} ${y} ${visible}`
    if (key === suitShown) return
    suitShown = key
    suitHandler({ x, y, visible })
  }

  function removeSunMap() {
    if (overlay) (overlay.material as MeshBasicMaterial).map?.dispose()
    overlay = undefined
    probeMark = undefined
    probe = null
    probeShown = ''
    probeHandler?.(null)
    gardenMark = undefined // cleared with the world
    gardenAt = null
  }

  function populate() {
    stopWalk()
    clearHover()
    removeSunMap()
    clearWorld()
    suitMesh = suitMark = undefined // cleared with the world; the data is painted again below
    gardenMapMeshes = [] // cleared with the world; the page asks for the plant map again after a scene change
    version++
    sceneChange?.()
    apartmentMeshes = new Set()
    aptLines = []
    glassMeshes = []
    ceilingMaterial = addedAboveMaterial = undefined
    glowMaterials = []
    floorMesh = undefined
    solidMeshes = []
    paintSuitability()
    const selected = selectedBuilding
    const hidden = hiddenOutlines(buildings)
    // A selection merged from several polygons (sources) draws its own pieces (members) instead of them.
    const highlighted = new Set(selected?.sources ?? [selectedId])
    if (selected && !selected.sources && hidden.has(selected.id)) {
      for (const p of partsOf(selected, buildings)) highlighted.add(p.id)
    }
    selectedIds = highlighted
    const selectedPieces = selected?.members ?? buildings.filter((b) => highlighted.has(b.id) && !hidden.has(b.id))
    const addMesh = (b: Building, color: number) => {
      const mesh = new Mesh(buildingGeometry(b), isGuessed(b) ? hatchedMaterial(color) : new MeshStandardMaterial({ color }))
      mesh.castShadow = true
      mesh.receiveShadow = true
      world.add(mesh)
    }
    for (const b of buildings) {
      if (!hidden.has(b.id) && !highlighted.has(b.id)) addMesh(b, OTHER_COLOR)
    }
    if (!plan) for (const b of selectedPieces) addMesh(b, SELECTED_COLOR)
    if (!selected) return
    if (plan) {
      addApartment(selected, plan)
      for (const o of panelMeshes(plan.panels)) world.add(o)
      const { c, radius } = apartmentBounds(selected, plan)
      const mid = floorBase(selected, plan) + plan.floorHeight / 2
      aptLight.target.position.set(c.x, mid, c.z)
      const cam = aptLight.shadow.camera
      cam.left = cam.bottom = -(radius + 5)
      cam.right = cam.top = radius + 5
      cam.updateProjectionMatrix()
      if (lastSun) update(lastSun)
    }
  }

  function buildingFraming(b: Building) {
    const c = ringCentroid(b.outer)
    let half = 5
    for (const p of b.outer) half = Math.max(half, Math.abs(p.x - c.x), Math.abs(p.z - c.z))
    return { c, dist: Math.max(40, half * 3 + b.height) }
  }

  function frameBuilding(b: Building) {
    const { c, dist } = buildingFraming(b)
    frame(
      new Vector3(c.x + dist * 0.6, b.height / 2 + dist * 0.5, c.z + dist * 0.8),
      new Vector3(c.x, b.height / 2, c.z),
    )
  }

  // From above at ~45 degrees, on the side opposite the windows so they are seen from inside.
  function frameApartment(b: Building, p: Plan, tight: boolean) {
    const { c, radius } = apartmentBounds(b, p, tight)
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
    const dist = radius * (tight ? 4.5 : 3) + 6
    frame(target.clone().addScaledVector(side, dist * 0.7).setY(target.y + dist * 0.7), target)
  }

  function setBuildings(next: Building[], choice: Building | string, { keepCamera = false } = {}) {
    setExtent(DATA_EXTENT)
    buildings = next
    selectedBuilding = typeof choice === 'string' ? next.find((b) => b.id === choice) : choice
    selectedId = selectedBuilding?.id ?? ''
    if (plan?.buildingId !== selectedId || !selectedBuilding) plan = null
    populate()
    if (selectedBuilding && !keepCamera) frameBuilding(selectedBuilding)
  }

  function setPlan(next: Plan | null, { close = false, keepView = false } = {}) {
    const selected = selectedBuilding
    const accepted = next && selected && next.buildingId === selected.id ? next : null
    const first = accepted && !plan
    plan = accepted
    populate()
    if (accepted && selected && first && !keepView) {
      cutaway = true
      applyCutaway()
      frameApartment(selected, accepted, close)
    }
  }

  let walking = false
  let walkHandlers: (WalkHandlers & { change(walking: boolean): void }) | undefined
  const saved = { position: new Vector3(), target: new Vector3() }
  const walk = createWalkControls(camera, renderer.domElement, {
    exit: () => walkHandlers?.exit(),
    stepTime: (m) => walkHandlers?.stepTime(m),
    togglePlay: () => walkHandlers?.togglePlay(),
    toggleCutaway: () => walkHandlers?.toggleCutaway(),
    toggleSunMap: () => walkHandlers?.toggleSunMap(),
  })

  function startWalk(at?: { x: number; z: number }): boolean {
    const selected = selectedBuilding
    if (!plan || !selected) return false
    if (!walking) {
      saved.position.copy(camera.position)
      saved.target.copy(controls.target)
    }
    const start = walkStart(plan, at)
    walking = true
    clearHover()
    controls.enabled = false
    camera.fov = WALK_FOV
    camera.near = WALK_NEAR
    camera.updateProjectionMatrix()
    walk.start(plan, floorBase(selected, plan), start.pos, start.yaw)
    applyCutaway()
    applyGlow()
    applyOverlayOpacity()
    renderer.domElement.style.cursor = 'grab'
    walkHandlers?.change(true)
    return true
  }

  function stopWalk() {
    if (!walking) return
    walking = false
    walk.stop()
    controls.enabled = true
    camera.fov = ORBIT_FOV
    camera.near = ORBIT_NEAR
    camera.updateProjectionMatrix()
    camera.position.copy(saved.position)
    controls.target.copy(saved.target)
    controls.update()
    renderer.domElement.style.cursor = ''
    applyCutaway()
    applyGlow()
    applyOverlayOpacity()
    walkHandlers?.change(false)
  }

  // Double-click on the apartment floor (not through a wall) stands there.
  const raycaster = new Raycaster()
  renderer.domElement.addEventListener('dblclick', (e) => {
    if (walking || !plan || !floorMesh) return
    const rect = renderer.domElement.getBoundingClientRect()
    const ndc = new Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
    raycaster.setFromCamera(ndc, camera)
    const hit = raycaster.intersectObjects(solidMeshes, false)[0]
    if (hit?.object !== floorMesh || !insideOutline(plan, { x: hit.point.x, z: hit.point.z })) return
    startWalk({ x: hit.point.x, z: hit.point.z })
  })

  // A click (without dragging) names the building polygon under the cursor: shift adds it to or removes it from the
  // selection, a plain click on another building switches to it.
  let partClick: ((polygonId: string) => void) | undefined
  let buildingClick: ((polygonId: string, at: { x: number; z: number }) => void) | undefined
  let downAt: { x: number; y: number } | undefined
  renderer.domElement.addEventListener('pointerdown', (e) => (downAt = { x: e.clientX, y: e.clientY }))
  // The building polygon under the pointer and the scene point hit, or undefined (sky, ground, glass, hidden floors).
  // The first thing the camera sees under the pointer: not glass, not an overlay, not a hidden (cutaway) block.
  function seenHit(clientX: number, clientY: number) {
    const rect = renderer.domElement.getBoundingClientRect()
    const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    raycaster.setFromCamera(ndc, camera)
    const seen = (o: Object3D) =>
      o instanceof Mesh && !glassMeshes.includes(o) && [o.material].flat().every((m) => m.colorWrite && !m.transparent)
    return raycaster.intersectObjects(world.children, true).find((h) => seen(h.object))
  }
  function polygonAt(clientX: number, clientY: number): { polygon: Building; hit: Vector3; dir: Vector3 } | undefined {
    const hit = seenHit(clientX, clientY)
    if (!hit || hit.object.userData.panelId) return undefined // a panel is not a building: it opens its card
    // A wall hit lies on the polygon's edge: step a little way along the ray, into the building.
    const dir = raycaster.ray.direction
    const flat = Math.hypot(dir.x, dir.z) || 1
    const at = { x: hit.point.x + (dir.x / flat) * 0.15, z: hit.point.z + (dir.z / flat) * 0.15 }
    const hidden = hiddenOutlines(buildings)
    const here = buildings.filter((b) => !hidden.has(b.id) && hit.point.y >= b.minHeight - 0.3 && hit.point.y <= b.height + 0.3)
    const polygon = pickBuilding(here, at)
    return polygon && { polygon, hit: hit.point, dir }
  }

  renderer.domElement.addEventListener('click', (e) => {
    if (walking || !(e.shiftKey ? partClick : buildingClick) || !isClick(downAt, { x: e.clientX, y: e.clientY })) return
    const found = polygonAt(e.clientX, e.clientY)
    if (!found) return
    if (e.shiftKey) partClick?.(found.polygon.id)
    else if (!selectedIds.has(found.polygon.id)) buildingClick?.(found.polygon.id, { x: found.hit.x, z: found.hit.z })
  })

  // A plain click on a solar panel names it (its card opens); a click on anything else reports null (it closes the card).
  let panelClick: ((id: string | null) => void) | undefined
  renderer.domElement.addEventListener('click', (e) => {
    if (walking || !panelClick || !isClick(downAt, { x: e.clientX, y: e.clientY })) return
    panelClick(seenHit(e.clientX, e.clientY)?.object.userData.panelId ?? null)
  })

  // A click on the apartment floor reports its point; a click anywhere else reports null (it closes the popover).
  // In 3D that needs the sun map showing. Walking, it works with the map off too (the caller turns it on).
  // Dragging is an orbit, a pan or a look, and a double-click walks (all stay as they were).
  let floorClick: ((at: { x: number; z: number } | null) => void) | undefined
  renderer.domElement.addEventListener('click', (e) => {
    if (!(walking || (sunMapOn && overlay)) || !floorClick || !plan || !isClick(downAt, { x: e.clientX, y: e.clientY })) return
    const hit = seenHit(e.clientX, e.clientY)
    const at = hit && hit.object === floorMesh && insideOutline(plan, { x: hit.point.x, z: hit.point.z }) ? { x: hit.point.x, z: hit.point.z } : null
    floorClick(at)
  })

  // The Garden view: a plain click names the surface the camera sees (not glass, not an overlay, not a hidden block).
  renderer.domElement.addEventListener('click', (e) => {
    if (walking || !gardenPicking || !gardenClick || !isClick(downAt, { x: e.clientX, y: e.clientY })) return
    const built = seenHit(e.clientX, e.clientY) // also aims the raycaster at the pointer
    // The ground plane is not part of the world group: it is the nearer hit when nothing built is in front of it.
    const flatGround = raycaster.intersectObject(ground, false)[0]
    if (flatGround && (!built || flatGround.distance < built.distance)) return gardenClick({ x: flatGround.point.x, y: 0, z: flatGround.point.z, normalY: 1, apartmentFloor: false })
    if (!built) return gardenClick(null)
    const normalY = built.face ? built.face.normal.clone().transformDirection(built.object.matrixWorld).y : 0
    const { x, y, z } = built.point
    const onFloor = built.object === floorMesh && plan !== null && insideOutline(plan, { x, z })
    // With the floors above hidden, the top of the visible storey is the cut through the building, not a roof. Inside the
    // apartment's outline the click means the floor under it.
    const cut = !onFloor && cutawayNow() && normalY > 0.7 && apartmentMeshes.has(built.object as Mesh)
    if (cut && floorMesh && plan && insideOutline(plan, { x, z })) {
      const down = new Raycaster(new Vector3(x, y, z), new Vector3(0, -1, 0)).intersectObject(floorMesh, false)[0]
      if (down) return gardenClick({ x, y: down.point.y, z, normalY: 1, apartmentFloor: true })
    }
    gardenClick({ x, y, z, normalY, apartmentFloor: onFloor, cut })
  })

  // A click on a quad of the suitability map names its sample (the nearer of the quad and whatever the camera sees
  // first, so a wall or a neighbour in front hides it); a click anywhere else reports null. A drag or double-click is
  // an orbit or a walk and does nothing here.
  let suitClick: ((index: number | null) => void) | undefined
  renderer.domElement.addEventListener('click', (e) => {
    if (walking || !suitOn || !suitMesh || !suitClick || !isClick(downAt, { x: e.clientX, y: e.clientY })) return
    const front = seenHit(e.clientX, e.clientY) // also aims the raycaster at the pointer
    const hits: Intersection[] = []
    Mesh.prototype.raycast.call(suitMesh, raycaster, hits)
    const quad = hits.sort((a, b) => a.distance - b.distance)[0]
    suitClick(quad && (!front || quad.distance <= front.distance) ? Math.floor(quad.faceIndex! / 2) : null)
  })

  // Hover cue for switching buildings: a pointer cursor and an amber tint on an unselected building. One raycast
  // per animation frame at most, and none while a button is down (orbit or pan drag) or while walking.
  let hoverMark: Group | undefined
  let hoverId: string | undefined
  let hoverEvent: { x: number; y: number } | undefined
  let hoverFrame = 0
  let hoverHandler: ((polygon: Building | null, at: { x: number; y: number }) => void) | undefined
  let hoverShown: Building | undefined
  function clearHover() {
    hoverShown = undefined
    hoverEvent = undefined
    if (hoverMark) {
      scene.remove(hoverMark)
      for (const child of hoverMark.children) {
        if (child instanceof Mesh || child instanceof LineSegments) {
          child.geometry.dispose()
          child.material.dispose()
        }
      }
      hoverMark = undefined
    }
    hoverId = undefined
    hoverHandler?.(null, { x: 0, y: 0 })
    if (!walking) renderer.domElement.style.cursor = ''
  }
  function showHover(polygon: Building) {
    if (polygon.id === hoverId) return
    clearHover()
    hoverId = polygon.id
    const geometry = buildingGeometry(polygon)
    const tint = new Mesh(
      geometry,
      new MeshBasicMaterial({
        color: OUTLINE_COLOR, transparent: true, opacity: HOVER_OPACITY, depthWrite: false, toneMapped: false,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      }),
    )
    const edges = new LineSegments(
      new EdgesGeometry(geometry, EDGE_ANGLE_DEG),
      new LineBasicMaterial({ color: OUTLINE_COLOR, transparent: true, opacity: HOVER_EDGE_OPACITY, depthWrite: false, toneMapped: false }),
    )
    hoverMark = new Group()
    hoverMark.add(tint, edges)
    scene.add(hoverMark)
  }
  function updateHover() {
    hoverFrame = 0
    if (!hoverEvent || walking || !buildingClick) return
    const at = hoverEvent
    const found = polygonAt(at.x, at.y)
    if (!found) {
      if (hoverShown) clearHover()
      return
    }
    if (selectedIds.has(found.polygon.id)) {
      if (hoverId !== undefined) clearHover()
      hoverEvent = at
    } else {
      showHover(found.polygon)
      renderer.domElement.style.cursor = 'pointer'
    }
    hoverShown = found.polygon
    hoverHandler?.(found.polygon, at)
  }
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (walking || e.buttons !== 0) {
      if (hoverId !== undefined) clearHover()
      return
    }
    hoverEvent = { x: e.clientX, y: e.clientY }
    if (!hoverFrame) hoverFrame = requestAnimationFrame(updateHover)
  })
  // A right-click (without dragging, which pans) on a building asks for its height; the browser menu stays away.
  let menuClick: ((polygonId: string, at: { x: number; y: number }) => void) | undefined
  renderer.domElement.addEventListener('contextmenu', (e) => {
    if (walking || !menuClick) return
    e.preventDefault()
    if (!isClick(downAt, { x: e.clientX, y: e.clientY })) return
    const found = polygonAt(e.clientX, e.clientY)
    if (found) menuClick(found.polygon.id, { x: e.clientX, y: e.clientY })
  })
  renderer.domElement.addEventListener('pointerleave', clearHover)
  renderer.domElement.addEventListener('pointerdown', clearHover)

  function setTrees(trees: Tree[]) {
    scene.remove(treeGroup)
    disposeTreeGroup(treeGroup)
    treeGroup = buildTreeGroup(trees)
    scene.add(treeGroup)
    version++
    sceneChange?.()
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
      if (!(o instanceof Mesh) || apartmentMeshes.has(o) || glassMeshes.includes(o) || aptLines.some((l) => l.line === o)) return
      for (const m of [o.material].flat()) hidden.set(m, { colorWrite: m.colorWrite, depthWrite: m.depthWrite })
    })
    for (const m of hidden.keys() as Iterable<MeshStandardMaterial>) m.colorWrite = m.depthWrite = false
    for (const g of glassMeshes) g.visible = true
    showAptLines(true)
    sunDisc.visible = false
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

  // The sky and the sun follow the camera, so they stay at infinity.
  function placeSky() {
    sky.mesh.position.copy(camera.position)
    sunDisc.visible = lastSun !== undefined && sunUp
    if (lastSun) {
      const { x, y, z } = lastSun.vector
      sunDisc.position.set(x, y, z).multiplyScalar(SUN_DISTANCE).add(camera.position)
    }
  }

  let lastFrame = performance.now()
  function render() {
    const now = performance.now()
    if (walking) {
      walk.update((now - lastFrame) / 1000)
      walkHandlers?.look?.(walk.yaw)
    }
    else controls.update()
    lastFrame = now
    placeSky()
    const twoPass = plan !== null && sunUp
    for (const g of glassMeshes) g.visible = !twoPass
    // The second pass repaints the apartment surfaces, so their edge lines are drawn there instead.
    showAptLines(!twoPass)
    renderer.render(scene, camera)
    if (twoPass) renderApartmentPass()
    for (const g of glassMeshes) g.visible = true
    reportProbe()
    reportSuitMark()
    reportBuildingView()
    if (gardenMark) gardenMark.scale.setScalar(Math.min(8, Math.max(1, camera.position.distanceTo(gardenMark.position) / 20)))
  }
  renderer.setAnimationLoop(render)
  // Lets the visual checks (scripts driving the dev server) project floor points to pixels.
  if (import.meta.env.DEV) Object.assign(window, { __sunpatchCamera: camera, __sunpatchControls: controls })

  return {
    update,
    setBuildings,
    setPlan,
    setTrees,
    setCutaway,
    onPartClick(handler) {
      partClick = handler
    },
    onBuildingClick(handler) {
      buildingClick = handler
    },
    onPanelClick(handler) {
      panelClick = handler
    },
    setMarkGuessed(on) {
      hatchStrength.value = on ? 1 : 0
    },
    onBuildingHover(handler) {
      hoverHandler = handler
    },
    onBuildingMenu(handler) {
      menuClick = handler
    },
    sceneVersion: () => version,
    occluders: () => collectOccluders([world, treeGroup]),
    onSceneChange(handler) {
      sceneChange = handler
    },
    setSunMap(map) {
      sunMapData = map
      paintSunMap()
    },
    setSunMapVisible(on) {
      sunMapOn = on
    },
    setSuitability(map) {
      suitData = map
      suitIndex = null
      paintSuitability()
    },
    setSuitabilityVisible(on) {
      suitOn = on
      applyCutaway()
    },
    onBuildingInView(handler) {
      viewHandler = handler
      viewShown = undefined
    },
    frameSelected() {
      if (selectedBuilding && !walking) frameBuilding(selectedBuilding)
    },
    setSuitabilityMark(index) {
      suitIndex = index
      paintSuitMark()
      if (index === null) reportSuitMark()
    },
    onSuitabilityScreen(handler) {
      suitHandler = handler
    },
    onSuitabilityClick(handler) {
      suitClick = handler
    },
    setProbe(at) {
      probe = at
      paintProbe()
      if (!at) reportProbe()
    },
    onProbeScreen(handler) {
      probeHandler = handler
    },
    onFloorClick(handler) {
      floorClick = handler
    },
    setGardenPicking(on) {
      gardenPicking = on
    },
    onGardenClick(handler) {
      gardenClick = handler
    },
    setGardenMap(map) {
      paintGardenMap(map)
    },
    setGardenMark(at) {
      gardenAt = at
      paintGardenMark()
    },
    startWalk,
    stopWalk,
    setWalkHandlers(handlers) {
      walkHandlers = handlers
    },
    resize,
    setActive(active) {
      if (!active) stopWalk()
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
