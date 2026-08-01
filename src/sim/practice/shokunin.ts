/**
 * Shokunin (craftsman) practice helpers — pure sim, no Three.js.
 *
 * Encodes disciplined training decisions used by the automated
 * practice path (`scripts/practice-shokunin.mjs`) and unit tests:
 *   - rank overflow tips by envelope / front logic (not "longest leaves")
 *   - identify primary trunk chain
 *   - sample active pack stem bend directions for wire set
 *
 * Multi-pack (#72): helpers default to getActivePracticePack() geometry.
 */
import { computeWorldFrames } from '../tree';
import type { Internode, NodeId, TreeState, Vec3 } from '../types';
import { getActivePracticePack, type PracticePack } from './target';

/** Coach / status copy for a ranked overflow tip (Practice + Inspect). */
export type OverflowReason =
  | 'Outside pad'
  | 'Above apex'
  | 'Depth spoils front';

export interface OverflowRanked {
  id: NodeId;
  /** Higher = worse for front silhouette; prune first. */
  overflowKey: number;
  tipX: number;
  tipY: number;
  tipZ: number;
  /** Primary human-readable reason for coaching / status. */
  reason: OverflowReason;
}

/**
 * Pick the dominant envelope failure for coach copy.
 * Weights match the contributions inside rankOverflowPruneTargets.
 */
export function primaryOverflowReason(contrib: {
  outsidePoly: boolean;
  lateralOver: number;
  heightOver: number;
  depthPenalty: number;
  lowFat: number;
}): OverflowReason {
  const cOutside =
    (contrib.outsidePoly ? 0.04 : 0) +
    contrib.lateralOver * 2.2 +
    contrib.lowFat;
  const cHeight = contrib.heightOver * 3.0;
  const cDepth = contrib.depthPenalty * 1.6;
  if (cHeight >= cOutside && cHeight >= cDepth && cHeight > 0) {
    return 'Above apex';
  }
  if (cDepth >= cOutside && cDepth >= cHeight && cDepth > 0) {
    return 'Depth spoils front';
  }
  return 'Outside pad';
}

function pointInPoly(
  x: number,
  y: number,
  poly: Array<[number, number]>,
): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Half-width of the target polygon at height y (soil-local m).
 * Returns 0 if the band has no interior sample.
 */
export function targetHalfWidthAt(
  y: number,
  poly?: Array<[number, number]>,
  pack: PracticePack = getActivePracticePack(),
): number {
  const p = poly ?? pack.polygon();
  const scanHalf = Math.max(pack.halfWidth * 1.5, 0.1);
  let minX = Infinity;
  let maxX = -Infinity;
  for (let i = 0; i < 64; i++) {
    const x = -scanHalf + (i / 63) * (2 * scanHalf);
    if (pointInPoly(x, y, p)) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }
  }
  if (!Number.isFinite(minX)) return 0;
  return (maxX - minX) / 2;
}

/**
 * Rank living leaf tips for structural prune.
 *
 * Prioritizes:
 *  - material outside the sumi polygon
 *  - tips above the apex band
 *  - depth that ruins the front read (|z|)
 *  - fat low laterals that kill taper
 *
 * Does **not** rank by length alone (that is the hack path).
 */
export function rankOverflowPruneTargets(
  tree: TreeState,
  opts: { max?: number; minKey?: number; pack?: PracticePack } = {},
): OverflowRanked[] {
  const max = opts.max ?? 16;
  const minKey = opts.minKey ?? 0.004;
  const pack = opts.pack ?? getActivePracticePack();
  const frames = computeWorldFrames(tree);
  const poly = pack.polygon();
  const ranked: OverflowRanked[] = [];

  for (const node of Object.values(tree.nodes)) {
    if (!node.living || node.id === tree.rootId) continue;
    // Structural edit: tips only (leaves)
    if (node.children.length > 0) continue;
    const f = frames.get(node.id);
    if (!f) continue;
    const tipX = f.tip[0];
    const tipY = f.tip[1];
    const tipZ = f.tip[2];
    const halfW = Math.max(targetHalfWidthAt(tipY, poly, pack), 0.006);
    const outsidePoly = !pointInPoly(tipX, tipY, poly);
    const lateralOver = Math.max(0, Math.abs(tipX) - halfW);
    const heightOver = Math.max(0, tipY - pack.height);
    const depthPenalty = Math.max(0, Math.abs(tipZ) - 0.018);
    const lowFat =
      tipY < pack.height * 0.34 && Math.abs(tipX) > halfW * 0.85
        ? 0.025
        : 0;

    const overflowKey =
      (outsidePoly ? 0.04 : 0) +
      lateralOver * 2.2 +
      heightOver * 3.0 +
      depthPenalty * 1.6 +
      lowFat;

    if (overflowKey < minKey) continue;
    ranked.push({
      id: node.id,
      overflowKey,
      tipX,
      tipY,
      tipZ,
      reason: primaryOverflowReason({
        outsidePoly,
        lateralOver,
        heightOver,
        depthPenalty,
        lowFat,
      }),
    });
  }

  ranked.sort((a, b) => b.overflowKey - a.overflowKey);
  return ranked.slice(0, max);
}

/**
 * Primary trunk node ids base → apex (excludes root).
 * Follows first-child chain (same convention as centerline scoring).
 */
export function primaryStemNodeIds(tree: TreeState): NodeId[] {
  const ids: NodeId[] = [];
  let cursor: NodeId | null = tree.rootId;
  let guard = 0;
  while (cursor && guard++ < 200) {
    const node: Internode | undefined = tree.nodes[cursor];
    if (!node || !node.living) break;
    if (cursor !== tree.rootId) ids.push(cursor);
    cursor = node.children.length > 0 ? node.children[0] : null;
  }
  return ids;
}

/**
 * Unit bend directions along the target stem polyline (segment tangents).
 * Suitable for successive `bend(nodeId, dir)` calls base → apex.
 */
export function stemBendDirections(
  stemPolyline: ReadonlyArray<readonly [number, number]> = getActivePracticePack()
    .stem,
): Vec3[] {
  const dirs: Vec3[] = [];
  for (let i = 0; i < stemPolyline.length - 1; i++) {
    const [x0, y0] = stemPolyline[i];
    const [x1, y1] = stemPolyline[i + 1];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    // Mild z so 3D wire has a hint of depth without ruining front plane
    const z = 0.04 * Math.sign(dx || 1) * (i % 2 === 0 ? 1 : -0.5);
    dirs.push([dx / len, dy / len, z]);
  }
  return dirs;
}

/**
 * Sample the PRACTICE_STEM tangent at a given soil-local height.
 * Used when wiring primary-chain nodes at known tipY.
 */
export function stemDirectionAtHeight(
  y: number,
  stemPolyline: ReadonlyArray<readonly [number, number]> = getActivePracticePack()
    .stem,
): Vec3 {
  if (stemPolyline.length < 2) return [0, 1, 0];
  // Find segment spanning y (or nearest)
  let bestI = 0;
  let bestDist = Infinity;
  for (let i = 0; i < stemPolyline.length - 1; i++) {
    const y0 = stemPolyline[i][1];
    const y1 = stemPolyline[i + 1][1];
    const mid = (y0 + y1) / 2;
    const d = Math.abs(mid - y);
    if (y >= y0 - 1e-6 && y <= y1 + 1e-6) {
      bestI = i;
      break;
    }
    if (d < bestDist) {
      bestDist = d;
      bestI = i;
    }
  }
  const [x0, y0] = stemPolyline[bestI];
  const [x1, y1] = stemPolyline[bestI + 1];
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  return [dx / len, dy / len, 0.03 * Math.sign(dx || 1)];
}

/** Desired stem x at height y (linear sample on pack stem / PRACTICE_STEM). */
export function stemXAtHeight(
  y: number,
  stemPolyline: ReadonlyArray<readonly [number, number]> = getActivePracticePack()
    .stem,
): number {
  if (stemPolyline.length < 2) return 0;
  if (y <= stemPolyline[0][1]) return stemPolyline[0][0];
  const last = stemPolyline[stemPolyline.length - 1];
  if (y >= last[1]) return last[0];
  for (let i = 0; i < stemPolyline.length - 1; i++) {
    const [x0, y0] = stemPolyline[i];
    const [x1, y1] = stemPolyline[i + 1];
    if (y >= y0 && y <= y1) {
      const t = (y - y0) / (y1 - y0 + 1e-12);
      return x0 + (x1 - x0) * t;
    }
  }
  return 0;
}
