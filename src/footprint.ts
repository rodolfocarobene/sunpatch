import { ExtrudeGeometry, Path, Shape, Vector2 } from 'three'
import type { Building, Point } from './osm'

// A Shape lives in the x/y plane and extrudes along +z. rotateX(-90 deg) sends (x, y, z) to
// (x, z, -y): extrusion becomes +y (up) and shape y becomes -z, so shape y = -scene z.
const toShape = (ring: Point[]) => ring.map((p) => new Vector2(p.x, -p.z))

/** Footprint extruded from minHeight to height, in scene coordinates (y up, north = -z). */
export function buildingGeometry(b: Building): ExtrudeGeometry {
  const shape = new Shape(toShape(b.outer))
  for (const hole of b.holes) shape.holes.push(new Path(toShape(hole)))
  const geometry = new ExtrudeGeometry(shape, { depth: b.height - b.minHeight, bevelEnabled: false })
  geometry.rotateX(-Math.PI / 2)
  geometry.translate(0, b.minHeight, 0)
  return geometry
}
