import type { NodeId, Vec3 } from '../types';

/** Species + global physics tuning. */
export interface PhysicsMaterialParams {
  /** Wood density (relative kg/m³ scale). */
  woodDensity: number;
  /** Young’s modulus for green wood (relative). */
  youngModulusGreen: number;
  /** Young’s modulus for fully lignified wood (relative). */
  youngModulusLignified: number;
  /** Damping ratio ζ for bend DOFs. */
  dampingRatio: number;
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
 * Defaults tuned for *visual* bonsai dynamics (slow sway), not structural FEA.
 * Over-stiff E + Euler → high-frequency ring that looks like vibration at rest.
 */
export const DEFAULT_PHYSICS_CONFIG: PhysicsConfig = {
  woodDensity: 650,
  // Visual moduli (2× from 5.5e3 / 1.125e5)
  youngModulusGreen: 1.1e4,
  youngModulusLignified: 2.25e5,
  // Extremely overdamped (10× prior 9.2) — free motion dies almost immediately
  dampingRatio: 92,
  foliageMassScale: 3.5e-5,
  maxDeflectionRad: 0.35,
  gravity: 9.81 * 0.22,
  cameraForceGain: 0.28,
  wireStiffnessMult: 12,
  substeps: 3,
  fixedDt: 1 / 90,
  // Very soft contacts (bias ~10× lower than prior soft pass)
  contactIterations: 1,
  contactSlop: 0.0015,
  contactBias: 0.01,
  frozen: false,
  collisions: true,
  sleepOmega: 0.06,
  sleepFrames: 12,
  wakeOmega: 0.12,
};
