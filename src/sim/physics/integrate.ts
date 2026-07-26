import { clamp } from '../math';
import type { TreeState } from '../types';
import { detectContacts } from './collide';
import { computeLiveWorldFrames } from './frames';
import { computeJointTorques } from './forces';
import { resolveContacts } from './resolve';
import type { ExternalForces, JointRuntime, PhysicsWorld } from './types';

const ZERO_EXTERNAL: ExternalForces = {
  gravity: true,
  cameraAccel: [0, 0, 0],
  cameraAlpha: [0, 0, 0],
  enabled: false,
};

/**
 * Advance the elastic joint simulation by wall-clock `dt` seconds.
 *
 * Integrator notes:
 * - Spring + damping use **implicit damping** so stiff joints don't ring at the
 *   Euler stability limit (was the main stationary vibration source).
 * - Collision projection adjusts θ only; residual closing velocity is killed
 *   (no synthetic ω injection from Δθ/h, which pumped energy).
 * - Quiet joints **sleep** so floating-point residual cannot buzz forever.
 */
export function stepPhysics(
  world: PhysicsWorld,
  tree: TreeState,
  dt: number,
  external: ExternalForces = ZERO_EXTERNAL,
): void {
  if (world.frozen || world.config.frozen) return;
  if (!tree.rootId || world.joints.size === 0) return;

  const cfg = world.config;
  const clamped = Math.min(Math.max(dt, 0), 0.05);
  if (clamped <= 0) return;

  // Camera activity wakes the whole tree
  if (external.enabled) {
    for (const j of world.joints.values()) {
      j.sleeping = false;
      j.quietFrames = 0;
    }
  }

  let remaining = clamped;
  // Prefer config.fixedDt; take enough substeps for the frame
  const h = cfg.fixedDt;
  const maxSteps = Math.max(1, cfg.substeps * 4);
  let guard = 0;

  while (remaining > 1e-8 && guard < maxSteps) {
    const step = Math.min(h, remaining);
    substep(world, tree, step, external);
    remaining -= step;
    guard += 1;
  }

  world.simTime += clamped;
}

function substep(
  world: PhysicsWorld,
  tree: TreeState,
  h: number,
  external: ExternalForces,
): void {
  const cfg = world.config;
  let frames = computeLiveWorldFrames(tree, world);
  const torques = computeJointTorques(tree, world, frames, external);

  for (const [id, joint] of world.joints) {
    if (joint.parentId === null) {
      joint.thetaX = 0;
      joint.thetaZ = 0;
      joint.omegaX = 0;
      joint.omegaZ = 0;
      joint.sleeping = true;
      continue;
    }

    if (joint.sleeping && !external.enabled) {
      joint.omegaX = 0;
      joint.omegaZ = 0;
      continue;
    }

    const t = torques.get(id) ?? { tx: 0, tz: 0 };
    integrateJoint(joint, t.tx, t.tz, h, cfg.maxDeflectionRad);
    updateSleep(joint, cfg.sleepOmega, cfg.sleepFrames, cfg.wakeOmega);
  }

  if (!cfg.collisions) {
    world.contacts = [];
    return;
  }

  // Collision: at most one detect+resolve pass per substep (multi-pass thrash)
  frames = computeLiveWorldFrames(tree, world);
  const contacts = detectContacts(tree, world, frames);
  world.contacts = contacts;
  if (contacts.length) {
    for (const c of contacts) {
      wakeJoint(world.joints.get(c.aId));
      if (c.bId) wakeJoint(world.joints.get(c.bId));
    }
    resolveContacts(tree, world, frames, contacts);
    // Very soft inelastic: barely bleed contact velocity
    for (const c of contacts) {
      dampJointVelocity(world.joints.get(c.aId), 0.92);
      if (c.bId) dampJointVelocity(world.joints.get(c.bId), 0.92);
    }
  }

  // Global settle assist when no camera force
  if (!external.enabled) {
    for (const joint of world.joints.values()) {
      if (joint.parentId === null || joint.sleeping) continue;
      const w = Math.hypot(joint.omegaX, joint.omegaZ);
      if (w < 2) {
        joint.omegaX *= 0.9;
        joint.omegaZ *= 0.9;
      }
    }
  }
}

/**
 * Implicit-damped semi-implicit Euler for τ = −kθ − cω + τ_ext:
 *   ω ← (ω + (τ_ext/J − (k/J)θ) h) / (1 + (c/J) h)
 *   θ ← θ + ω h
 */
function integrateJoint(
  joint: JointRuntime,
  tauExtX: number,
  tauExtZ: number,
  h: number,
  maxTheta: number,
): void {
  const J = Math.max(joint.J, 1e-10);
  const k = joint.k;
  const c = joint.c;
  const invJ = 1 / J;
  const dampDenom = 1 + (c * invJ) * h;

  // τ_spring is included via −kθ; τ_ext from forces already includes −kθ − cω.
  // Re-derive: forces returns full torque including spring+damp. Split for
  // implicit damp so we don't double-count c.
  // forces: τ = −kθ − cω + τ_body  ⇒  τ_body = τ + kθ + cω
  const bodyX = tauExtX + k * joint.thetaX + c * joint.omegaX;
  const bodyZ = tauExtZ + k * joint.thetaZ + c * joint.omegaZ;

  let omegaX =
    (joint.omegaX + (bodyX * invJ - k * invJ * joint.thetaX) * h) / dampDenom;
  let omegaZ =
    (joint.omegaZ + (bodyZ * invJ - k * invJ * joint.thetaZ) * h) / dampDenom;

  // Soft velocity cap — visual, not structural shock
  const maxW = 4;
  omegaX = clamp(omegaX, -maxW, maxW);
  omegaZ = clamp(omegaZ, -maxW, maxW);

  joint.omegaX = omegaX;
  joint.omegaZ = omegaZ;
  joint.thetaX = clamp(joint.thetaX + omegaX * h, -maxTheta, maxTheta);
  joint.thetaZ = clamp(joint.thetaZ + omegaZ * h, -maxTheta, maxTheta);

  // Hard stop on angle limits: fully kill that DOF's velocity (no chatter)
  if (Math.abs(joint.thetaX) >= maxTheta - 1e-6) joint.omegaX = 0;
  if (Math.abs(joint.thetaZ) >= maxTheta - 1e-6) joint.omegaZ = 0;
}

function updateSleep(
  joint: JointRuntime,
  sleepOmega: number,
  sleepFrames: number,
  wakeOmega: number,
): void {
  const w = Math.hypot(joint.omegaX, joint.omegaZ);
  if (w > wakeOmega) {
    joint.sleeping = false;
    joint.quietFrames = 0;
    return;
  }
  if (w < sleepOmega) {
    joint.quietFrames += 1;
    if (joint.quietFrames >= sleepFrames) {
      joint.sleeping = true;
      joint.omegaX = 0;
      joint.omegaZ = 0;
    }
  } else {
    joint.quietFrames = 0;
    joint.sleeping = false;
  }
}

function wakeJoint(j: JointRuntime | undefined): void {
  if (!j) return;
  j.sleeping = false;
  j.quietFrames = 0;
}

function dampJointVelocity(j: JointRuntime | undefined, factor: number): void {
  if (!j || j.parentId === null) return;
  j.omegaX *= factor;
  j.omegaZ *= factor;
}
