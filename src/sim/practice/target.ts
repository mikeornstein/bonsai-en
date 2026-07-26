/**
 * Sumi practice target — informal upright (moyogi) silhouette in soil-local meters.
 * y = 0 at soil surface; x = front plane (matches sumi ghost drawn at z≈0).
 *
 * Shared by the renderer outline and pure scoring (no Three.js).
 *
 * Design notes:
 * - ~25cm tall — matches a 1–2 year training sapling under our species scale
 * - Narrow foot, S-curve trunk, wider upper pad (classic reading)
 * - Wide enough that prune + wire can reach "close" without pixel-perfect geometry
 */

/** Ascending S-curve trunk spine (soil → apex) — for centerline scoring. */
export const PRACTICE_STEM: ReadonlyArray<readonly [number, number]> = [
  [0.0, 0.0],
  [-0.008, 0.03],
  [0.014, 0.07],
  [-0.018, 0.11],
  [0.016, 0.155],
  [-0.01, 0.195],
  [0.0, 0.24],
];

/**
 * Closed silhouette polygon: left edge up, right edge down.
 * Encloses a soft pad region around the stem S-curve.
 */
export function practiceTargetPolygon(): Array<[number, number]> {
  // Counter-clockwise: base → left canopy → apex → right canopy → base
  return [
    [0.0, 0.0],
    [-0.012, 0.025],
    [-0.028, 0.06],
    [-0.048, 0.1],
    [-0.058, 0.14],
    [-0.05, 0.18],
    [-0.032, 0.215],
    [-0.012, 0.24],
    [0.0, 0.255],
    [0.014, 0.24],
    [0.04, 0.21],
    [0.055, 0.17],
    [0.052, 0.125],
    [0.038, 0.085],
    [0.022, 0.05],
    [0.01, 0.02],
    [0.004, 0.0],
  ];
}

/** Target apex height above soil (m). */
export const PRACTICE_HEIGHT = 0.255;

/** Rough target half-width for raster bounds (m). */
export const PRACTICE_HALF_WIDTH = 0.07;
