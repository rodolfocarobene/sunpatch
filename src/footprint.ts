import { ExtrudeGeometry, Path, Shape, Vector2 } from 'three'
import type { Building, Point } from './osm'

// A Shape lives in the x/y plane and extrudes along +z. rotateX(-90 deg) sends (x, y, z) to
// (x, z, -y): extrusion becomes +y (up) and shape y becomes -z, so shape y = -scene z.
const toShape = (ring: Point[]) => ring.map((p) => new Vector2(p.x, -p.z))

/** Rings (outer plus holes) extruded from y = bottom to y = top, in scene coordinates. */
export function extrudeRings(outer: Point[], holes: Point[][], bottom: number, top: number): ExtrudeGeometry {
  const shape = new Shape(toShape(outer))
  for (const hole of holes) shape.holes.push(new Path(toShape(hole)))
  const geometry = new ExtrudeGeometry(shape, { depth: top - bottom, bevelEnabled: false })
  geometry.rotateX(-Math.PI / 2)
  geometry.translate(0, bottom, 0)
  return geometry
}

/** Footprint extruded from minHeight to height, in scene coordinates (y up, north = -z). */
export function buildingGeometry(b: Pick<Building, 'outer' | 'holes' | 'minHeight' | 'height'>): ExtrudeGeometry {
  return extrudeRings(b.outer, b.holes, b.minHeight, b.height)
}
