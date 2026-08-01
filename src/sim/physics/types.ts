import type { NodeId, Vec3 } from '../types';

/**
 * Species + global physics tuning.
 *
 * Bend stiffness is geometry-derived (beam theory):
 *   I = π r⁴ / 4
 *   E = lerp(E_green, E_lignified, smoothstep(lignification))
 *   k = stiffnessScale · (E I) / L   (+ wire mult)
 *
 * Damping uses a geometry/state-varying ζ (#94), not a single sludge constant:
 *   ζ = lerp(ζ_green, ζ_lignified, lignify) · (1 + tipBoost · thinness)
 *   c = 2 ζ √(k J)
 */
export interface PhysicsMaterialParams {
  /** Wood density (relative kg/m³ scale). */
  woodDensity: number;
  /** Young’s modulus for green wood (visual tree units, not SI). */
  youngModulusGreen: number;
  /** Young’s modulus for fully lignified wood (visual tree units). */
  youngModulusLignified: number;
  /**
   * Global scale α on beam stiffness k = α·(E I)/L.
   * Raise to stiffen the whole tree without changing E ratio.
   */
  stiffnessScale: number;
  /**
   * Legacy / uniform ζ fallback when green/lignified not distinguished
   * (tests may set this alone). Prefer dampingRatioGreen/Lignified.
   */
  dampingRatio: number;
  /** Damping ratio ζ for wet/green wood (higher = more sludge). */
  dampingRatioGreen: number;
  /** Damping ratio ζ for fully lignified wood (lower = livelier settle). */
  dampingRatioLignified: number;
  /**
   * Extra ζ multiplier on thin tips: ζ *= 1 + tipDampingBoost · clamp(1 − r/r_ref, 0, 1).
   */
  tipDampingBoost: number;
  /** Radius (m) below which tip damping boost ramps in. */
  tipRadiusRef: number;
  /** Scales foliage biomass into mass units. */
  foliageMassScale: number;
  /** Soft angle clamp (radians). */
  maxDeflectionRad: number;
  /** Gravity magnitude in tree units (m/s² scale). */
  gravity: number;
  /** Camera inertial field gain. */
  cameraForceGain: number;
  /** Multiplier on k while wired. */
  wireStiffnessMult: number;
}

export interface PhysicsConfig extends PhysicsMaterialParams {
  substeps: number;
  fixedDt: number;
  contactIterations: number;
  /** Acceptable residual penetration (m). */
  contactSlop: number;
  /** Baumgarte / projection strength for contacts. */
  contactBias: number;
  /** When true, integrator is a no-op (screenshots / ortho). */
  frozen: boolean;
  /** Enable self + environment collision resolve. */
  collisions: boolean;
  /**
   * Sleep: joints with |ω| below this and small residual force rest
   * until disturbed (stops stationary micro-buzz).
   */
  sleepOmega: number;
  /** Frames a joint must stay quiet before sleep. */
  sleepFrames: number;
  /** Wake if |ω| exceeds this or external camera force is active. */
  wakeOmega: number;
}

export interface JointRuntime {
  nodeId: NodeId;
  parentId: NodeId | null;
  children: NodeId[];
  /** Elastic bend about local X / Z relative to rest orientation. */
  thetaX: number;
  thetaZ: number;
  omegaX: number;
  omegaZ: number;
  /** Local wood + foliage mass. */
  mass: number;
  length: number;
  radius: number;
  lignification: number;
  wired: boolean;
  /** Bend stiffness and damping (cached at sync). */
  k: number;
  c: number;
  /** Effective rotational inertia about joint. */
  J: number;
  /** Quiet-frame counter for sleep. */
  quietFrames: number;
  /** When true, joint holds θ and zeros ω until woken. */
  sleeping: boolean;
}

export interface Contact {
  /** Dynamic node whose capsule is involved (primary). */
  aId: NodeId;
  /** Other dynamic node, or null for static env. */
  bId: NodeId | null;
  /** Contact normal world (from A into free space / out of B). */
  normal: Vec3;
  /** Penetration depth (> 0 means overlap). */
  depth: number;
  /** World-space contact point. */
  point: Vec3;
  /** Static env kind when bId is null. */
  env?: 'soil';
}

export interface ExternalForces {
  gravity: boolean;
  /** World linear acceleration of the camera (tree space). */
  cameraAccel: Vec3;
  /** Angular acceleration about tree origin (approx). */
  cameraAlpha: Vec3;
  enabled: boolean;
}

export interface PhysicsWorld {
  joints: Map<NodeId, JointRuntime>;
  rootId: NodeId;
  config: PhysicsConfig;
  contacts: Contact[];
  /** Topology fingerprint for sync. */
  topologyKey: string;
  frozen: boolean;
  /** Accumulated simulated time (s) for telemetry. */
  simTime: number;
}

/**
 * Defaults for visual bonsai dynamics after #83 denser internodes / #94 retune.
 * Geometry (r, L, lignify) drives k and ζ; values are not structural SI FEA.
 */
export const DEFAULT_PHYSICS_CONFIG: PhysicsConfig = {
  woodDensity: 650,
  // Stiffer visual moduli — thick lignified wood holds; tips stay relatively soft
  youngModulusGreen: 2.4e4,
  youngModulusLignified: 5.5e5,
  stiffnessScale: 2.0,
  // Fallback ζ if a caller only sets dampingRatio
  dampingRatio: 1.4,
  // Green more damped; lignified livelier (was uniform ζ=92 sludge)
  dampingRatioGreen: 2.6,
  dampingRatioLignified: 0.95,
  tipDampingBoost: 1.4,
  tipRadiusRef: 0.005,
  foliageMassScale: 3.5e-5,
  maxDeflectionRad: 0.35,
  gravity: 9.81 * 0.22,
  cameraForceGain: 0.28,
  wireStiffnessMult: 12,
  substeps: 3,
  fixedDt: 1 / 90,
  contactIterations: 1,
  contactSlop: 0.0015,
  contactBias: 0.01,
  frozen: false,
  collisions: true,
  sleepOmega: 0.06,
  sleepFrames: 14,
  wakeOmega: 0.12,
};
