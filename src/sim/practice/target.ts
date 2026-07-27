/**
 * Sumi practice target — informal upright (moyogi) silhouette in soil-local meters.
 * y = 0 at soil surface; x = front plane (matches sumi ghost drawn at z≈0).
 *
 * Shared by the renderer outline and pure scoring (no Three.js).
 *
 * Design notes (refs: docs/refs/sumi/ — issue #53):
 * - ~25cm tall — matches a 1–2 year training sapling under our species scale
 * - Stem: first left bend → right counter → upper return → apex near center
 *   (Tangopaso moyogi training sequence + original envelope plate)
 * - Envelope: cloud pad, not a pure diamond — narrow foot, soft waist, fuller
 *   asymmetric upper mass, rounded apex (procumbens / redwood informal upright)
 * - Wide enough that prune + wire can reach "close" without pixel-perfect geometry
 */

/** Ascending S-curve trunk spine (soil → apex) — for centerline scoring. */
export const PRACTICE_STEM: ReadonlyArray<readonly [number, number]> = [
  [0.0, 0.0],
  [-0.006, 0.025],
  [-0.016, 0.055],
  [0.006, 0.095],
  [0.018, 0.135],
  [-0.002, 0.175],
  [-0.012, 0.210],
  [0.002, 0.248],
];

/**
 * Closed silhouette polygon: left edge up, right edge down.
 * Soft cloud envelope around the stem S-curve (not a hard diamond).
 */
export function practiceTargetPolygon(): Array<[number, number]> {
  // Counter-clockwise: base → left canopy → apex → right canopy → base
  return [
    [0.0, 0.0],
    [-0.01, 0.022],
    [-0.02, 0.05],
    [-0.036, 0.085],
    [-0.052, 0.118],
    [-0.06, 0.152],
    [-0.054, 0.185],
    [-0.036, 0.215],
    [-0.014, 0.238],
    [0.002, 0.252],
    [0.018, 0.24],
    [0.04, 0.218],
    [0.058, 0.185],
    [0.064, 0.15],
    [0.058, 0.115],
    [0.044, 0.082],
    [0.028, 0.052],
    [0.014, 0.026],
    [0.004, 0.0],
  ];
}

/** Target apex height above soil (m). */
export const PRACTICE_HEIGHT = 0.252;

/** Rough target half-width for raster bounds (m). */
export const PRACTICE_HALF_WIDTH = 0.072;
