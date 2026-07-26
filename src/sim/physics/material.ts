import { clamp, lerp } from '../math';
import type { Internode } from '../types';
import type { PhysicsConfig } from './types';

/** Young’s modulus blended by lignification. */
export function youngModulus(
  lignification: number,
  cfg: PhysicsConfig,
): number {
  const t = clamp(lignification, 0, 1);
  // Non-linear: early green stays soft, then hardens
  const u = t * t * (3 - 2 * t);
  return lerp(cfg.youngModulusGreen, cfg.youngModulusLignified, u);
}

/** Second moment of area for circular section. */
export function sectionInertia(radius: number): number {
  const r = Math.max(radius, 1e-5);
  return (Math.PI / 4) * r * r * r * r;
}

export function bendStiffness(
  node: Internode,
  cfg: PhysicsConfig,
): number {
  const E = youngModulus(node.lignification, cfg);
  const I = sectionInertia(node.radius);
  const L = Math.max(node.length, 1e-4);
  let k = (E * I) / L;
  if (node.wire) {
    k *= cfg.wireStiffnessMult * (0.5 + node.wire.setAmount);
  }
  // Root is clamped separately; still give huge k if present
  if (node.parentId === null) {
    k *= 80;
  }
  return Math.max(k, 1e-3);
}

export function rotationalInertia(
  distalMass: number,
  length: number,
  localMass: number,
  k = 0,
  fixedDt = 1 / 90,
): number {
  const lever = Math.max(length * 0.55, 1e-4);
  const distal = distalMass * lever * lever;
  const local = localMass * (length * length) / 12;
  let J = Math.max(distal + local, 1e-8);
  // Stability floor for implicit-damped Euler: keep ω₀·dt ≲ 0.25 (gentle)
  if (k > 0 && fixedDt > 0) {
    const minJ = k * fixedDt * fixedDt * (1 / (0.25 * 0.25));
    J = Math.max(J, minJ);
  }
  return J;
}

export function bendDamping(k: number, J: number, cfg: PhysicsConfig): number {
  return 2 * cfg.dampingRatio * Math.sqrt(Math.max(k * J, 1e-12));
}
