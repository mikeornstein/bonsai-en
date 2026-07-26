/** Shared simulation types (pure data — no Three.js). */

export type NodeId = string;
export type BudId = string;
export type FoliageId = string;

export type BudType = 'terminal' | 'axillary' | 'adventitious';
export type BudState = 'dormant' | 'flushing' | 'dead';

export type Season = 'dormant' | 'earlyFlush' | 'mainFlush' | 'hardening' | 'rest';

/** Unit quaternion [x, y, z, w] — local orientation relative to parent axis. */
export type Quat = [number, number, number, number];

/** Unit direction or position [x, y, z]. */
export type Vec3 = [number, number, number];

export interface Bud {
  id: BudId;
  type: BudType;
  state: BudState;
  /** Position along parent internode [0, 1], tip = 1 for terminal. */
  t: number;
  /** Local azimuth for lateral buds (radians). */
  azimuth: number;
  /** Days since last state change. */
  ageDays: number;
  /** Accumulated force toward break (pruning stimulus, season). */
  breakForce: number;
}

export interface FoliageCluster {
  id: FoliageId;
  /** Position along internode [0, 1]. */
  t: number;
  azimuth: number;
  ageDays: number;
  /** Photosynthetic area proxy (cm²-ish arbitrary units). */
  area: number;
  biomass: number;
  efficiency: number;
  living: boolean;
}

export interface WireConstraint {
  /** Desired local orientation while wired. */
  targetOrientation: Quat;
  /** Orientation when wire was applied (for spring-back). */
  installOrientation: Quat;
  /** How much of the bend has permanently set [0, 1]. */
  setAmount: number;
  installedPlantDay: number;
  tension: number;
}

export interface Internode {
  id: NodeId;
  parentId: NodeId | null;
  children: NodeId[];
  /** Current length (m). */
  length: number;
  /** Target length during extension. */
  targetLength: number;
  /** Current radius (m). */
  radius: number;
  /** Pipe-model target radius. */
  targetRadius: number;
  /** Local orientation from parent tip direction. */
  orientation: Quat;
  ageDays: number;
  /** How set/lignified the wood is [0, 1]. */
  lignification: number;
  living: boolean;
  buds: Bud[];
  foliage: FoliageCluster[];
  wire?: WireConstraint;
  /** Wound intensity after prune [0, 1], decays over time. */
  wound: number;
}

export interface TreeState {
  schemaVersion: 1;
  speciesId: string;
  /** RNG seed for deterministic generation/growth noise. */
  seed: number;
  /** Plant age in days. */
  agePlantDays: number;
  /** Stored non-structural carbohydrates (arbitrary units). */
  reserves: number;
  /** Root structural mass proxy. */
  rootMass: number;
  /** Living vigor / water stress composite [0, 1]. */
  vigor: number;
  nodes: Record<NodeId, Internode>;
  rootId: NodeId;
  nextId: number;
}

export interface Environment {
  /** Relative light [0, 1]. */
  light: number;
  /** Temperature band factor for metabolism [0, 1]. */
  temperature: number;
  season: Season;
  /** Day of year [0, 365). */
  dayOfYear: number;
}

export interface GrowthStats {
  assimilates: number;
  maintenance: number;
  primarySpent: number;
  secondarySpent: number;
  newNodes: number;
  deadFoliage: number;
}
