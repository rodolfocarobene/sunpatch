import { BoxGeometry, EdgesGeometry, LineBasicMaterial, LineSegments, Matrix4, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import type { Panel } from './plan'
import { PANEL_THICKNESS, along, facing, footprintDepth, modules } from './panel'

const PV_COLOR = 0x24324d
const FRAME_COLOR = 0xaab6c6

/**
 * One box per module, a thin slab placed from tilt, azimuth and elevation, with light edge lines for the frame.
 * Panels float: what carries them (roof, terrace, railing, ground) is not modelled, only where the glass is.
 * The boxes cast and receive shadows, so the sun map counts them as occluders; the lines never do.
 */
export function panelMeshes(panels: Panel[]): (Mesh | LineSegments)[] {
  const pv = new MeshStandardMaterial({ color: PV_COLOR, roughness: 0.45, metalness: 0.25 })
  const frame = new LineBasicMaterial({ color: FRAME_COLOR })
  const out: (Mesh | LineSegments)[] = []
  for (const p of panels) {
    const t = (p.tilt * Math.PI) / 180
    const f = facing(p.azimuth)
    const r = along(p.azimuth)
    // Local axes: x along the row, y the panel normal, z up the slope (x cross y = z).
    const x = new Vector3(r.x, 0, r.z)
    const y = new Vector3(Math.sin(t) * f.x, Math.cos(t), Math.sin(t) * f.z)
    const z = new Vector3(-Math.cos(t) * f.x, Math.sin(t), -Math.cos(t) * f.z)
    const reach = footprintDepth(p) / 2
    const lowEdge = new Vector3(p.x + f.x * reach, p.elevation, p.z + f.z * reach)
    const n = modules(p)
    for (let i = 0; i < n; i++) {
      const centre = lowEdge.clone().addScaledVector(z, p.height / 2).addScaledVector(x, (i - (n - 1) / 2) * p.width)
      const geometry = new BoxGeometry(p.width, PANEL_THICKNESS, p.height)
      const mesh = new Mesh(geometry, pv)
      mesh.matrixAutoUpdate = false
      mesh.matrix.makeBasis(x, y, z).setPosition(centre)
      mesh.castShadow = true
      mesh.userData.panelId = p.id
      mesh.receiveShadow = true
      const lines = new LineSegments(new EdgesGeometry(geometry), frame)
      lines.matrixAutoUpdate = false
      lines.matrix.copy(mesh.matrix)
      out.push(mesh, lines)
    }
  }
  return out
}

/** The determinant of the panel basis, for tests: positive means the boxes are not mirrored. */
export const basisHandedness = (azimuth: number, tilt: number): number => {
  const t = (tilt * Math.PI) / 180
  const f = facing(azimuth)
  const r = along(azimuth)
  return new Matrix4().makeBasis(
    new Vector3(r.x, 0, r.z),
    new Vector3(Math.sin(t) * f.x, Math.cos(t), Math.sin(t) * f.z),
    new Vector3(-Math.cos(t) * f.x, Math.sin(t), -Math.cos(t) * f.z),
  ).determinant()
}
