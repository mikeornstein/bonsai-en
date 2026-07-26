/**
 * Quantitative practice-mode silhouette match (pure TS, no Three.js).
 *
 * Compares living wood+foliage to the sumi target in the front (x,y) plane.
 * Uses envelope / centerline metrics (not filled IoU of a solid pad), so a
 * real bonsai skeleton can score well without solid foliage mass.
 */
import { computeWorldFrames } from '../tree';
import type { Internode, NodeId, TreeState } from '../types';
import {
  PRACTICE_HALF_WIDTH,
  PRACTICE_HEIGHT,
  PRACTICE_STEM,
  practiceTargetPolygon,
} from './target';

export type PracticeGrade = 'far' | 'forming' | 'close' | 'match';

export interface PracticeScore {
  /** Combined quality in [0, 1]. */
  score: number;
  /**
   * Legacy name: now = containment (fraction of tree mass inside target).
   * Kept for harness stability.
   */
  iou: number;
  /** Fraction of height bands where tree width is near target width. */
  coverage: number;
  /** Fraction of tree raster cells outside the target polygon. */
  overflow: number;
  /** RMS distance of main-stem tips to target centerline (m). */
  centerlineRmse: number;
  /** Tree height / target height (1 = same apex). */
  heightRatio: number;
  /** How well front-plane widths track the target by height band. */
  bandFit: number;
  grade: PracticeGrade;
  /** Short HUD copy, e.g. "Practice · close 62". */
  label: string;
}

const GRID_W = 80;
const GRID_H = 100;
const X_MIN = -PRACTICE_HALF_WIDTH * 1.4;
const X_MAX = PRACTICE_HALF_WIDTH * 1.4;
const Y_MIN = -0.01;
const Y_MAX = PRACTICE_HEIGHT * 1.2;
const BANDS = 12;

function cellIndex(ix: number, iy: number): number {
  return iy * GRID_W + ix;
}

function pointInPoly(x: number, y: number, poly: Array<[number, number]>): boolean {
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

function stampDisk(
  grid: Uint8Array,
  cx: number,
  cy: number,
  radius: number,
): void {
  const r = Math.max(radius, (X_MAX - X_MIN) / GRID_W);
  const i0 = Math.max(0, Math.floor(((cx - r - X_MIN) / (X_MAX - X_MIN)) * GRID_W));
  const i1 = Math.min(
    GRID_W - 1,
    Math.floor(((cx + r - X_MIN) / (X_MAX - X_MIN)) * GRID_W),
  );
  const j0 = Math.max(0, Math.floor(((cy - r - Y_MIN) / (Y_MAX - Y_MIN)) * GRID_H));
  const j1 = Math.min(
    GRID_H - 1,
    Math.floor(((cy + r - Y_MIN) / (Y_MAX - Y_MIN)) * GRID_H),
  );
  const r2 = r * r;
  for (let iy = j0; iy <= j1; iy++) {
    const y = Y_MIN + ((iy + 0.5) / GRID_H) * (Y_MAX - Y_MIN);
    for (let ix = i0; ix <= i1; ix++) {
      const x = X_MIN + ((ix + 0.5) / GRID_W) * (X_MAX - X_MIN);
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) grid[cellIndex(ix, iy)] = 1;
    }
  }
}

function stampSegment(
  grid: Uint8Array,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const steps = Math.max(2, Math.ceil(len / ((X_MAX - X_MIN) / GRID_W / 2)));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    stampDisk(grid, x0 + dx * t, y0 + dy * t, radius);
  }
}

function fillPolygon(grid: Uint8Array, poly: Array<[number, number]>): void {
  for (let iy = 0; iy < GRID_H; iy++) {
    const y = Y_MIN + ((iy + 0.5) / GRID_H) * (Y_MAX - Y_MIN);
    for (let ix = 0; ix < GRID_W; ix++) {
      const x = X_MIN + ((ix + 0.5) / GRID_W) * (X_MAX - X_MIN);
      if (pointInPoly(x, y, poly)) grid[cellIndex(ix, iy)] = 1;
    }
  }
}

function distToPolyline(
  x: number,
  y: number,
  line: ReadonlyArray<readonly [number, number]>,
): number {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const [x0, y0] = line[i];
    const [x1, y1] = line[i + 1];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const L2 = dx * dx + dy * dy || 1e-12;
    let t = ((x - x0) * dx + (y - y0) * dy) / L2;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy)));
  }
  return best;
}

/** Min/max x of polygon (or tree) within a y band. */
function bandWidth(
  samples: Array<{ x: number; y: number; r: number }>,
  y0: number,
  y1: number,
): { width: number; present: boolean; mid: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  for (const s of samples) {
    if (s.y + s.r < y0 || s.y - s.r > y1) continue;
    minX = Math.min(minX, s.x - s.r);
    maxX = Math.max(maxX, s.x + s.r);
  }
  if (!Number.isFinite(minX)) return { width: 0, present: false, mid: 0 };
  return { width: maxX - minX, present: true, mid: (minX + maxX) / 2 };
}

function targetBandWidth(
  poly: Array<[number, number]>,
  y0: number,
  y1: number,
): { width: number; present: boolean; mid: number } {
  // Sample polygon edges for points in band
  const pts: Array<{ x: number; y: number; r: number }> = [];
  for (let i = 0; i < poly.length; i++) {
    const [x0, yy0] = poly[i];
    const [x1, yy1] = poly[(i + 1) % poly.length];
    for (let s = 0; s <= 8; s++) {
      const t = s / 8;
      const y = yy0 + (yy1 - yy0) * t;
      if (y >= y0 && y <= y1) {
        pts.push({ x: x0 + (x1 - x0) * t, y, r: 0.002 });
      }
    }
  }
  // Also interior scan for filled width
  let minX = Infinity;
  let maxX = -Infinity;
  const midY = (y0 + y1) / 2;
  for (let i = 0; i < 64; i++) {
    const x = X_MIN + ((i + 0.5) / 64) * (X_MAX - X_MIN);
    if (pointInPoly(x, midY, poly)) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }
  }
  if (!Number.isFinite(minX)) {
    return bandWidth(pts, y0, y1);
  }
  return { width: maxX - minX, present: true, mid: (minX + maxX) / 2 };
}

function gradeFromScore(score: number): PracticeGrade {
  // Calibrated so a stock sapling is usually "forming", trained trees can
  // reach "close", and "match" requires deliberate envelope work.
  if (score >= 0.82) return 'match';
  if (score >= 0.72) return 'close';
  if (score >= 0.45) return 'forming';
  return 'far';
}

function labelFor(grade: PracticeGrade, score: number): string {
  const pct = Math.round(score * 100);
  switch (grade) {
    case 'match':
      return `Practice · match ${pct}`;
    case 'close':
      return `Practice · close ${pct}`;
    case 'forming':
      return `Practice · forming ${pct}`;
    default:
      return `Practice · far ${pct}`;
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Score how well the live tree silhouette matches the sumi practice target.
 * Coordinates: tree world frames with root at soil origin (y up).
 */
export function scorePracticeMatch(tree: TreeState): PracticeScore {
  const frames = computeWorldFrames(tree);
  const target = practiceTargetPolygon();
  const targetGrid = new Uint8Array(GRID_W * GRID_H);
  const treeGrid = new Uint8Array(GRID_W * GRID_H);
  fillPolygon(targetGrid, target);

  const treeSamples: Array<{ x: number; y: number; r: number }> = [];
  let maxY = 0;

  for (const node of Object.values(tree.nodes)) {
    if (!node.living) continue;
    const f = frames.get(node.id);
    if (!f) continue;
    maxY = Math.max(maxY, f.tip[1], f.base[1]);
    const woodR = Math.max(node.radius * 1.8, 0.0025);
    stampSegment(
      treeGrid,
      f.base[0],
      f.base[1],
      f.tip[0],
      f.tip[1],
      woodR,
    );
    treeSamples.push({
      x: (f.base[0] + f.tip[0]) / 2,
      y: (f.base[1] + f.tip[1]) / 2,
      r: woodR,
    });
    treeSamples.push({ x: f.tip[0], y: f.tip[1], r: woodR });

    for (const fol of node.foliage) {
      if (!fol.living) continue;
      const t = Math.min(1, Math.max(0, fol.t));
      const fx = f.base[0] + (f.tip[0] - f.base[0]) * t;
      const fy = f.base[1] + (f.tip[1] - f.base[1]) * t;
      const side = Math.cos(fol.azimuth) * 0.008 * Math.sqrt(fol.area * 800);
      const padR = Math.max(0.006, Math.sqrt(fol.area) * 0.35);
      stampDisk(treeGrid, fx + side, fy, padR);
      treeSamples.push({ x: fx + side, y: fy, r: padR });
    }
  }

  let treeCount = 0;
  let outside = 0;
  for (let i = 0; i < treeGrid.length; i++) {
    if (!treeGrid[i]) continue;
    treeCount++;
    if (!targetGrid[i]) outside++;
  }
  const overflow = treeCount > 0 ? outside / treeCount : 1;
  const containment = 1 - overflow;

  // Height-band envelope fit
  let bandSum = 0;
  let bandN = 0;
  let presence = 0;
  let presenceN = 0;
  for (let b = 0; b < BANDS; b++) {
    const y0 = (b / BANDS) * PRACTICE_HEIGHT;
    const y1 = ((b + 1) / BANDS) * PRACTICE_HEIGHT;
    const tBand = targetBandWidth(target, y0, y1);
    if (!tBand.present || tBand.width < 0.004) continue;
    presenceN++;
    const trBand = bandWidth(treeSamples, y0, y1);
    if (trBand.present) presence++;
    // Relative width error (tree may be thinner — softer penalty)
    const tw = Math.max(tBand.width, 0.008);
    const rw = trBand.present ? trBand.width : 0;
    // Prefer tree width ≤ target (stay inside), mild reward for filling ≥50%
    const fillRatio = rw / tw;
    const widthScore =
      fillRatio <= 1
        ? Math.exp(-2.5 * Math.abs(fillRatio - 0.75)) // sweet spot ~75% of pad width
        : Math.exp(-3.5 * (fillRatio - 1)); // overflow width
    // Horizontal mid alignment
    const midErr = trBand.present ? Math.abs(trBand.mid - tBand.mid) : tBand.width;
    const midScore = Math.exp(-midErr / 0.025);
    bandSum += 0.65 * widthScore + 0.35 * midScore;
    bandN++;
  }
  const bandFit = bandN > 0 ? bandSum / bandN : 0;
  const presenceFit = presenceN > 0 ? presence / presenceN : 0;

  // Main stem centerline
  const stemSamples: Array<[number, number]> = [];
  let cursor: NodeId | null = tree.rootId;
  let guard = 0;
  while (cursor && guard++ < 200) {
    const node: Internode | undefined = tree.nodes[cursor];
    const f = frames.get(cursor);
    if (!node || !f) break;
    stemSamples.push([f.tip[0], f.tip[1]]);
    cursor = node.children.length > 0 ? node.children[0] : null;
  }
  let centerlineRmse = 0;
  if (stemSamples.length) {
    let sum = 0;
    for (const [x, y] of stemSamples) {
      sum += distToPolyline(x, y, PRACTICE_STEM) ** 2;
    }
    centerlineRmse = Math.sqrt(sum / stemSamples.length);
  } else {
    centerlineRmse = PRACTICE_HALF_WIDTH;
  }
  const centerlineFit = Math.exp(-centerlineRmse / 0.02);

  const heightRatio = PRACTICE_HEIGHT > 0 ? maxY / PRACTICE_HEIGHT : 0;
  const heightFit = Math.exp(
    -2.0 * Math.abs(Math.log(Math.max(0.2, heightRatio))),
  );

  // Envelope-first blend — sparse trees can still score "close"
  const score = clamp01(
    0.28 * containment +
      0.26 * bandFit +
      0.18 * centerlineFit +
      0.14 * heightFit +
      0.14 * presenceFit,
  );

  const grade = gradeFromScore(score);
  return {
    score,
    iou: containment, // harness: containment under historical key
    coverage: bandFit,
    overflow,
    centerlineRmse,
    heightRatio,
    bandFit,
    grade,
    label: labelFor(grade, score),
  };
}

/** ASCII debug dump of target vs tree masks (for tests / agents). */
export function debugPracticeRaster(tree: TreeState): string {
  const frames = computeWorldFrames(tree);
  const target = practiceTargetPolygon();
  const targetGrid = new Uint8Array(GRID_W * GRID_H);
  const treeGrid = new Uint8Array(GRID_W * GRID_H);
  fillPolygon(targetGrid, target);
  for (const node of Object.values(tree.nodes)) {
    if (!node.living) continue;
    const f = frames.get(node.id);
    if (!f) continue;
    stampSegment(
      treeGrid,
      f.base[0],
      f.base[1],
      f.tip[0],
      f.tip[1],
      Math.max(node.radius * 1.8, 0.0025),
    );
  }
  const cols = 24;
  const rows = 20;
  const lines: string[] = [];
  for (let ry = rows - 1; ry >= 0; ry--) {
    let line = '';
    for (let cx = 0; cx < cols; cx++) {
      const ix = Math.floor((cx / cols) * GRID_W);
      const iy = Math.floor((ry / rows) * GRID_H);
      const t = targetGrid[cellIndex(ix, iy)];
      const tr = treeGrid[cellIndex(ix, iy)];
      if (t && tr) line += '█';
      else if (t) line += '·';
      else if (tr) line += '░';
      else line += ' ';
    }
    lines.push(line);
  }
  void frames;
  return lines.join('\n');
}
