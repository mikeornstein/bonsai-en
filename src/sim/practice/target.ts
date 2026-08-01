/**
 * Sumi practice target packs — silhouettes in soil-local meters.
 * y = 0 at soil surface; x = front plane (matches sumi ghost drawn at z≈0).
 *
 * Shared by the renderer outline and pure scoring (no Three.js).
 *
 * Packs (#72):
 * - moyogi (default) — informal upright cloud pad (#53 refs)
 * - cascade — semi-cascade (han-kengai): crest then flow toward/below rim
 * - literati — bunjin: tall sparse S-curve, narrow envelope
 *
 * Design notes for moyogi (refs: docs/refs/sumi/ — issue #53):
 * - ~25cm tall — matches a 1–2 year training sapling under our species scale
 * - Stem: first left bend → right counter → upper return → apex near center
 * - Envelope: cloud pad, not a pure diamond
 */

/** Known practice silhouette packs. */
export type PracticePackId = 'moyogi' | 'cascade' | 'literati';

export interface PracticePack {
  id: PracticePackId;
  /** Menu / HUD name. */
  name: string;
  /** Ascending (or flowing) trunk spine for centerline scoring. */
  stem: ReadonlyArray<readonly [number, number]>;
  /** Closed silhouette polygon (soil-local m). Fresh array each call. */
  polygon: () => Array<[number, number]>;
  /** Target design height = max y of silhouette (m). */
  height: number;
  /** Rough target half-width for raster bounds (m). */
  halfWidth: number;
  /** Min y of silhouette (cascade may go below soil). Default 0. */
  yMin?: number;
  /** Optional boot / status hint when this pack is active. */
  hint?: string;
}

// ── Moyogi (informal upright) — default; numbers must stay stable for scores ─

const MOYOGI_STEM: ReadonlyArray<readonly [number, number]> = [
  [0.0, 0.0],
  [-0.006, 0.025],
  [-0.016, 0.055],
  [0.006, 0.095],
  [0.018, 0.135],
  [-0.002, 0.175],
  [-0.012, 0.210],
  [0.002, 0.248],
];

function moyogiPolygon(): Array<[number, number]> {
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

export const MOYOGI_PACK: PracticePack = {
  id: 'moyogi',
  name: 'Moyogi',
  stem: MOYOGI_STEM,
  polygon: moyogiPolygon,
  height: 0.252,
  halfWidth: 0.072,
  yMin: 0,
  hint: 'Match the ink · prune outside · wire the trunk · grow into the pad',
};

// ── Cascade (semi-cascade / han-kengai) ─────────────────────────────────────
// Trunk rises to a crest, then flows down and out; apex near/below pot rim.
// Readable front silhouette with similar vertex density to moyogi.

const CASCADE_STEM: ReadonlyArray<readonly [number, number]> = [
  [0.0, 0.0],
  [0.01, 0.03],
  [0.02, 0.062],
  [0.028, 0.095], // crest
  [0.04, 0.078],
  [0.055, 0.048],
  [0.068, 0.018],
  [0.078, -0.012],
  [0.085, -0.038], // cascade tip below rim
];

function cascadePolygon(): Array<[number, number]> {
  // Flowing teardrop to +x; denser outline for ink ghost readability
  return [
    [0.0, 0.0],
    [-0.012, 0.028],
    [-0.008, 0.055],
    [0.004, 0.085],
    [0.018, 0.108], // crest left
    [0.038, 0.112],
    [0.055, 0.095],
    [0.07, 0.065],
    [0.082, 0.03],
    [0.092, -0.005],
    [0.096, -0.032],
    [0.09, -0.048], // tip
    [0.072, -0.042],
    [0.055, -0.02],
    [0.042, 0.012],
    [0.03, 0.042],
    [0.018, 0.068],
    [0.008, 0.04],
    [0.002, 0.012],
  ];
}

export const CASCADE_PACK: PracticePack = {
  id: 'cascade',
  name: 'Cascade',
  stem: CASCADE_STEM,
  polygon: cascadePolygon,
  height: 0.112,
  halfWidth: 0.1,
  yMin: -0.05,
  hint: 'Semi-cascade · crest then flow · prune for the fall · wire the line down',
};

// ── Literati (bunjin) ───────────────────────────────────────────────────────
// Tall sparse S-curve, narrow envelope — elegance over mass.

const LITERATI_STEM: ReadonlyArray<readonly [number, number]> = [
  [0.0, 0.0],
  [-0.008, 0.04],
  [-0.018, 0.09],
  [0.01, 0.15],
  [0.02, 0.21],
  [-0.008, 0.27],
  [0.004, 0.318],
];

function literatiPolygon(): Array<[number, number]> {
  // Narrow cloud — sparse pads, tall rhythm
  return [
    [0.0, 0.0],
    [-0.008, 0.03],
    [-0.016, 0.07],
    [-0.028, 0.11],
    [-0.022, 0.15],
    [-0.012, 0.19],
    [-0.024, 0.23],
    [-0.018, 0.27],
    [-0.006, 0.3],
    [0.004, 0.32],
    [0.014, 0.305],
    [0.022, 0.27],
    [0.016, 0.23],
    [0.028, 0.19],
    [0.024, 0.15],
    [0.014, 0.11],
    [0.012, 0.07],
    [0.008, 0.03],
    [0.002, 0.0],
  ];
}

export const LITERATI_PACK: PracticePack = {
  id: 'literati',
  name: 'Literati',
  stem: LITERATI_STEM,
  polygon: literatiPolygon,
  height: 0.32,
  halfWidth: 0.038,
  yMin: 0,
  hint: 'Literati · tall sparse line · wire the S · keep the envelope narrow',
};

/** Registry order for menu cycle: default first. */
export const PRACTICE_PACKS: readonly PracticePack[] = [
  MOYOGI_PACK,
  CASCADE_PACK,
  LITERATI_PACK,
];

const PACK_BY_ID: Record<PracticePackId, PracticePack> = {
  moyogi: MOYOGI_PACK,
  cascade: CASCADE_PACK,
  literati: LITERATI_PACK,
};

/** Default pack id (moyogi). */
export const DEFAULT_PRACTICE_PACK_ID: PracticePackId = 'moyogi';

let activePackId: PracticePackId = DEFAULT_PRACTICE_PACK_ID;

export function isPracticePackId(id: string): id is PracticePackId {
  return id === 'moyogi' || id === 'cascade' || id === 'literati';
}

export function getPracticePack(id: PracticePackId): PracticePack {
  return PACK_BY_ID[id];
}

/** Active pack for scoring / ghost (defaults to moyogi). */
export function getActivePracticePack(): PracticePack {
  return PACK_BY_ID[activePackId];
}

export function getActivePracticePackId(): PracticePackId {
  return activePackId;
}

/**
 * Set the active practice silhouette pack.
 * Returns the resolved pack (unknown ids fall back to moyogi).
 */
export function setActivePracticePack(id: string): PracticePack {
  activePackId = isPracticePackId(id) ? id : DEFAULT_PRACTICE_PACK_ID;
  return PACK_BY_ID[activePackId];
}

/** Cycle moyogi → cascade → literati → moyogi. */
export function cyclePracticePack(): PracticePack {
  const i = PRACTICE_PACKS.findIndex((p) => p.id === activePackId);
  const next = PRACTICE_PACKS[(i + 1) % PRACTICE_PACKS.length];
  activePackId = next.id;
  return next;
}

// ── Backward-compatible moyogi exports (stable numbers for existing tests) ──

/** Ascending S-curve trunk spine (soil → apex) — moyogi default. */
export const PRACTICE_STEM: ReadonlyArray<readonly [number, number]> =
  MOYOGI_STEM;

/**
 * Closed silhouette polygon for the **active** pack (default moyogi).
 * Prefer `getActivePracticePack().polygon()` or `getPracticePack(id).polygon()`.
 */
export function practiceTargetPolygon(): Array<[number, number]> {
  return getActivePracticePack().polygon();
}

/** Moyogi apex height above soil (m). Prefer pack.height for multi-pack. */
export const PRACTICE_HEIGHT = MOYOGI_PACK.height;

/** Moyogi half-width for raster bounds (m). Prefer pack.halfWidth. */
export const PRACTICE_HALF_WIDTH = MOYOGI_PACK.halfWidth;
