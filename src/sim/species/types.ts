import type { Season } from '../types';

export interface SpeciesDefinition {
  id: string;
  commonName: string;
  scientificName: string;
  evergreen: boolean;

  /** Typical internode length range (m). */
  internodeLength: { min: number; max: number };
  /** Starting sapling trunk radius (m). */
  saplingRadius: number;
  /** Max reasonable radius for bonsai trunk (m). */
  maxRadius: number;

  /** Lateral branch angle from parent axis (radians). */
  branchAngle: { mean: number; std: number };
  /** Probability a flushing node forms a lateral bud each day during flush. */
  lateralBudChance: number;
  /** Max children per node (excluding terminal extension). */
  maxChildren: number;

  /** Photosynthetic rate per foliage area unit per day at full light. */
  photosynthesisRate: number;
  /** Maintenance cost per woody volume unit per day. */
  woodMaintenance: number;
  /** Maintenance cost per foliage biomass per day. */
  foliageMaintenance: number;

  /** Fraction of surplus allocated to primary vs secondary vs storage. */
  allocation: {
    primary: number;
    secondary: number;
    storage: number;
    roots: number;
  };

  /** Carbon cost per meter of primary extension. */
  primaryCostPerMeter: number;
  /** Carbon cost per m³ of wood added. */
  secondaryCostPerVolume: number;

  /** Daily radial growth toward pipe target as fraction of gap. */
  radialGrowthRate: number;
  /** Leaf area → cross-section coefficient for pipe model (m² leaf / m² wood). */
  pipeCoefficient: number;

  /** Apical dominance strength (0–1). */
  apicalDominance: number;
  /** How fast auxin-like suppression decays down the axis per internode. */
  dominanceDecay: number;
  /** Pruning stimulus added to nearby buds. */
  pruneStimulus: number;
  /** Break force threshold for dormant → flushing. */
  budBreakThreshold: number;

  /** Foliage area created per new flush internode. */
  foliageAreaPerInternode: number;
  /** Foliage lifespan (days) before efficiency drops. */
  foliageLifespanDays: number;
  /** Daily senescence rate for old foliage. */
  foliageSenescenceRate: number;

  /** Days for wood to fully lignify under normal growth. */
  lignificationDays: number;
  /** Daily set amount while wired (base). */
  wireSetRate: number;

  /** Root:shoot target mass ratio. */
  rootShootRatio: number;

  /** Seasonal growth multiplier by season. */
  seasonGrowth: Record<Season, number>;

  /** Initial sapling: number of internodes in main stem. */
  saplingStemNodes: number;
  /** Initial laterals. */
  saplingLaterals: number;
}
