import { Color, MeshLambertMaterial } from 'three';

/** Brand colours sampled from the original logo file. */
export const BRAND = {
  navy: 0x11123c,
  magenta: 0xed107e,
  cyan: 0x00aeef,
  orange: 0xf7941d,
  paper: 0xf4f1ea,
  white: 0xffffff,
} as const;

/**
 * Light rig constants. Lighting is calibrated so that an upward-facing surface is lit
 * with a factor of exactly 1: a magenta top face renders the logo magenta, not an
 * approximation of it. Side faces fall away towards a cool ambient tone.
 */
export const LIGHT_DIR: [number, number, number] = [-0.5, 1.0, 0.35];
export const AMBIENT_RGB: [number, number, number] = [0.52, 0.52, 0.62];

const lightLen = Math.hypot(...LIGHT_DIR);
export const NL_TOP = LIGHT_DIR[1] / lightLen;

/** Key light colour that complements the ambient term so top faces sum to 1 per channel. */
export function keyLightColor(): Color {
  return new Color(
    (1 - AMBIENT_RGB[0]) / NL_TOP,
    (1 - AMBIENT_RGB[1]) / NL_TOP,
    (1 - AMBIENT_RGB[2]) / NL_TOP,
  );
}

/**
 * Navy is too dark for shading to show form if the lit face is the brand navy, so the
 * relationship is inverted: the brand navy is the shaded tone, and lit faces lift
 * towards indigo.
 */
function litNavy(): Color {
  const c = new Color(BRAND.navy);
  c.r /= AMBIENT_RGB[0] * 0.6;
  c.g /= AMBIENT_RGB[1] * 0.6;
  c.b /= AMBIENT_RGB[2] * 0.6;
  return c;
}

/**
 * White parts are softened so their shaded faces stay light and papery: part of the
 * surface colour is moved into an emissive term, which keeps the top face at the same
 * value while reducing the spread between lit and shaded faces.
 */
function soft(hex: number, lift: number): MeshLambertMaterial {
  const target = new Color(hex);
  const color = target.clone().multiplyScalar(1 - lift);
  const emissive = target.clone().multiplyScalar(lift);
  return new MeshLambertMaterial({ color, emissive });
}

export interface Materials {
  navy: MeshLambertMaterial;
  magenta: MeshLambertMaterial;
  cyan: MeshLambertMaterial;
  orange: MeshLambertMaterial;
  white: MeshLambertMaterial;
  bone: MeshLambertMaterial;
}

export function createMaterials(): Materials {
  return {
    navy: new MeshLambertMaterial({ color: litNavy() }),
    magenta: soft(BRAND.magenta, 0.12),
    cyan: soft(BRAND.cyan, 0.12),
    orange: soft(BRAND.orange, 0.12),
    white: soft(0xffffff, 0.42),
    bone: soft(0xe9e5dc, 0.36),
  };
}
