import { Color, MeshLambertMaterial } from 'three';

/**
 * Colours for the 3D stage. The four brand colours are sampled from the original logo
 * file; the stage itself is the logo's navy, so the scene is drawn the way the mark
 * would be reversed out of navy: white hexagons, the magenta bar, and the dots.
 */
export const BRAND = {
  navy: 0x11123c,
  magenta: 0xed107e,
  cyan: 0x00aeef,
  orange: 0xf7941d,
  white: 0xffffff,
  /** The page ground behind the transparent canvas. Lattice lines fade into it. */
  ground: 0x11123c,
  lattice: 0x4347a8,
  shadow: 0x03041a,
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
 * Part of the surface colour is moved into an emissive term. The top face keeps the
 * same value while the spread between lit and shaded faces narrows, so light parts
 * stay light on their shaded sides and accents stay saturated.
 */
function soft(hex: number, lift: number): MeshLambertMaterial {
  const target = new Color(hex);
  const color = target.clone().multiplyScalar(1 - lift);
  const emissive = target.clone().multiplyScalar(lift);
  return new MeshLambertMaterial({ color, emissive });
}

export interface Materials {
  /** The open hexagons: white, as the mark reads on navy. */
  frame: MeshLambertMaterial;
  /** Structural detail. A lit indigo from the navy family that stands clear of the ground. */
  navy: MeshLambertMaterial;
  /** The logo navy itself, for marks printed on the white quote sheet. */
  ink: MeshLambertMaterial;
  /** Recessed plates: a step lighter than the ground. */
  deck: MeshLambertMaterial;
  magenta: MeshLambertMaterial;
  cyan: MeshLambertMaterial;
  orange: MeshLambertMaterial;
  white: MeshLambertMaterial;
  bone: MeshLambertMaterial;
}

export function createMaterials(): Materials {
  return {
    frame: soft(0xffffff, 0.3),
    navy: soft(0x4447b8, 0.1),
    ink: soft(0x1b1c58, 0.2),
    deck: soft(0x2a2c7c, 0.12),
    magenta: soft(BRAND.magenta, 0.12),
    cyan: soft(BRAND.cyan, 0.12),
    orange: soft(BRAND.orange, 0.12),
    white: soft(0xffffff, 0.44),
    bone: soft(0xc9cee8, 0.3),
  };
}
