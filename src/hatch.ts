import { MeshStandardMaterial } from 'three'

/** Shared by every hatched material: 1 draws the stripes, 0 leaves the plain colour (the "Mark guessed heights" switch). */
export const hatchStrength = { value: 1 }

/** Stripes repeat every PERIOD metres along the diagonal, cover SHARE of it, and darken the colour by DARKEN. */
const PERIOD = 1.6
const SHARE = 0.4
const DARKEN = 0.18

/**
 * A standard material whose colour carries thin diagonal stripes, drawn in world space so they run across walls
 * and roofs alike. Only the albedo is touched: lighting, and the shadows it casts and receives, are those of the
 * plain material. Seen from afar the stripes would shimmer, so they widen in steps to stay readable at any distance.
 */
export function hatchedMaterial(color: number): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color })
  material.onBeforeCompile = (shader) => {
    shader.uniforms.hatchStrength = hatchStrength
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHatchPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHatchPos = (modelMatrix * vec4(transformed, 1.0)).xyz;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHatchPos;\nuniform float hatchStrength;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          // World metres per pixel here: the stripes widen in steps (x2) so they stay at least ~14 px apart from afar.
          float perPixel = length(fwidth(vHatchPos));
          float period = ${PERIOD.toFixed(2)} * exp2(ceil(log2(max(1.0, perPixel * 14.0 / ${PERIOD.toFixed(2)}))));
          float u = ((vHatchPos.x + vHatchPos.z) * 0.7071 + vHatchPos.y) / period;
          float w = fwidth(u);
          float t = fract(u);
          float edge = max(w, 0.02);
          float stripe = smoothstep(0.0, edge, t) * (1.0 - smoothstep(${SHARE.toFixed(2)}, ${SHARE.toFixed(2)} + edge, t));
          diffuseColor.rgb *= 1.0 - ${DARKEN.toFixed(2)} * stripe * hatchStrength;
        }`,
      )
  }
  material.customProgramCacheKey = () => 'hatch'
  return material
}
