import type { SpeciesDefinition } from './types';

/**
 * Juniperus procumbens-inspired parameters for a training bonsai sapling.
 * Units are stylized but rates aim for multi-year training feel under acceleration.
 */
export const juniper: SpeciesDefinition = {
  id: 'juniper-procumbens',
  commonName: 'Juniper',
  scientificName: 'Juniperus procumbens',
  evergreen: true,

  // ~6–14 mm internodes (#83): finer prune/wire/curvature; pot scale via node count
  internodeLength: { min: 0.006, max: 0.014 },
  saplingRadius: 0.007,
  /** ~0.45 mm tip floor — fine laterals without zero-radius wood (#58). */
  minRadius: 0.00045,
  maxRadius: 0.05,

  // Lateral takeoff from parent (~48°). Continuations stay collinear (#87).
  // Real juniper laterals are often sub-horizontal under apical control, not
  // random doglegs — angle is applied once at fork, not every internode.
  branchAngle: { mean: 0.85, std: 0.12 },
  /**
   * Base chance for new axillaries during flush. Real junipers flush monopodial
   * shoots first, then bud along the axis — keep this modest (#87).
   */
  lateralBudChance: 0.016,
  /** One living lateral per internode — no multi-lateral clumps (#87). */
  maxChildren: 1,
  // Sibling lateral separation — avoids parallel “railroad” forks (#39)
  /** ~35° minimum azimuth between laterals on the same node. */
  minSiblingAngle: 0.61,
  /** Golden-angle spiral; open-sector fallback on conflict. */
  phyllotaxis: 'golden',
  /** Soft cone/ray occupancy (~1 cm); 0 would disable free-space probes. */
  freeSpaceProbeRadius: 0.01,
  /** Cap resample cost under Years acceleration. */
  branchAzimuthRetries: 8,

  // Photosynthesis high enough that multi-year fast-forward stays solvent
  photosynthesisRate: 2.4,
  woodMaintenance: 0.02,
  foliageMaintenance: 0.04,

  allocation: {
    primary: 0.34,
    secondary: 0.26,
    storage: 0.26,
    roots: 0.14,
  },

  primaryCostPerMeter: 28,
  secondaryCostPerVolume: 9000,

  radialGrowthRate: 0.014,
  pipeCoefficient: 2200,

  // Moderate tip control: freer than pre-#87 but not so free low wood sprouts (#87)
  apicalDominance: 0.66,
  // Still faster than #83 √-parity so mid-axis can fork
  dominanceDecay: 0.76,
  pruneStimulus: 0.35,
  budBreakThreshold: 0.45,

  // ~half area/node so total foliage per meter of axis holds (#83)
  foliageAreaPerInternode: 0.000275,
  foliageLifespanDays: 900,
  foliageSenescenceRate: 0.0012,

  lignificationDays: 180,
  wireSetRate: 0.006,

  rootShootRatio: 0.45,

  seasonGrowth: {
    dormant: 0.12,
    earlyFlush: 0.9,
    mainFlush: 1.0,
    hardening: 0.5,
    rest: 0.2,
  },

  // Doubled with half internode length so stem height fills the pot (#83)
  saplingStemNodes: 14,
  saplingLaterals: 4,

  physics: {
    woodDensity: 650,
    // Visual-scale moduli (see DEFAULT_PHYSICS_CONFIG) — not FEA wood
    youngModulusGreen: 1.1e4,
    youngModulusLignified: 2.25e5,
    dampingRatio: 92,
    foliageMassScale: 3.5e-5,
    maxDeflectionRad: 0.35,
    gravity: 9.81 * 0.22,
    cameraForceGain: 0.28,
    wireStiffnessMult: 12,
  },
};

export const SPECIES_REGISTRY: Record<string, SpeciesDefinition> = {
  [juniper.id]: juniper,
};

export function getSpecies(id: string): SpeciesDefinition {
  const s = SPECIES_REGISTRY[id];
  if (!s) throw new Error(`Unknown species: ${id}`);
  return s;
}
