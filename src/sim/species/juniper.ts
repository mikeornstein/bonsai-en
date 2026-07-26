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

  // Slightly larger units so a training sapling fills the pot visually
  internodeLength: { min: 0.012, max: 0.028 },
  saplingRadius: 0.007,
  maxRadius: 0.05,

  // Acute branching typical of juniper pads
  branchAngle: { mean: 0.62, std: 0.16 },
  lateralBudChance: 0.018,
  maxChildren: 3,

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

  apicalDominance: 0.78,
  dominanceDecay: 0.55,
  pruneStimulus: 0.35,
  budBreakThreshold: 0.55,

  foliageAreaPerInternode: 0.00055,
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

  saplingStemNodes: 7,
  saplingLaterals: 4,
};

export const SPECIES_REGISTRY: Record<string, SpeciesDefinition> = {
  [juniper.id]: juniper,
};

export function getSpecies(id: string): SpeciesDefinition {
  const s = SPECIES_REGISTRY[id];
  if (!s) throw new Error(`Unknown species: ${id}`);
  return s;
}
