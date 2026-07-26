import type { PhysicsWorld } from './types';

/** Snapshot of kinetic / residual motion for quantitative analysis. */
export interface PhysicsTelemetry {
  /** Max |ω| over free joints (rad/s). */
  maxOmega: number;
  /** RMS |ω| over free joints. */
  rmsOmega: number;
  /** Max |θ| deflection (rad). */
  maxTheta: number;
  /** Sum of ½ J ω² over free joints. */
  kineticEnergy: number;
  /** Number of free (non-root) joints. */
  freeJoints: number;
  /** Joints currently sleeping. */
  sleeping: number;
  /** Active contacts last step. */
  contacts: number;
  /** Wall time simulated since create/reset (s). */
  simTime: number;
}

export function measureTelemetry(world: PhysicsWorld): PhysicsTelemetry {
  let maxOmega = 0;
  let sumOmegaSq = 0;
  let maxTheta = 0;
  let ke = 0;
  let free = 0;
  let sleeping = 0;

  for (const j of world.joints.values()) {
    if (j.parentId === null) continue;
    free += 1;
    if (j.sleeping) sleeping += 1;
    const w2 = j.omegaX * j.omegaX + j.omegaZ * j.omegaZ;
    const w = Math.sqrt(w2);
    maxOmega = Math.max(maxOmega, w);
    sumOmegaSq += w2;
    maxTheta = Math.max(
      maxTheta,
      Math.hypot(j.thetaX, j.thetaZ),
    );
    ke += 0.5 * j.J * w2;
  }

  return {
    maxOmega,
    rmsOmega: free > 0 ? Math.sqrt(sumOmegaSq / free) : 0,
    maxTheta,
    kineticEnergy: ke,
    freeJoints: free,
    sleeping,
    contacts: world.contacts.length,
    simTime: world.simTime,
  };
}

/** True when free motion is below sleep thresholds. */
export function isQuiescent(
  world: PhysicsWorld,
  maxOmegaEps = 0.02,
  maxKeEps = 1e-8,
): boolean {
  const t = measureTelemetry(world);
  return t.maxOmega < maxOmegaEps && t.kineticEnergy < maxKeEps;
}
