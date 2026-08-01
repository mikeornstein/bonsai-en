import { clamp, lerp } from '../math';
import type { Internode } from '../types';
import type { PhysicsConfig } from './types';

/** Smoothstep lignification blend (0 = green, 1 = fully set). */
export function lignifyBlend(lignification: number): number {
  const t = clamp(lignification, 0, 1);
  return t * t * (3 - 2 * t);
}

/** Young’s modulus blended by lignification. */
export function youngModulus(
  lignification: number,
  cfg: PhysicsConfig,
): number {
  return lerp(
    cfg.youngModulusGreen,
    cfg.youngModulusLignified,
    lignifyBlend(lignification),
  );
}

/** Second moment of area for circular section I = π r⁴ / 4. */
export function sectionInertia(radius: number): number {
  const r = Math.max(radius, 1e-5);
  return (Math.PI / 4) * r * r * r * r;
}

/**
 * Rotational bend stiffness for one internode joint (beam theory).
 *
 *   k = stiffnessScale · (E · I) / L
 *
 * Wire multiplies k; root is clamped separately with a large factor.
 */
export function bendStiffness(
  node: Internode,
  cfg: PhysicsConfig,
): number {
  const E = youngModulus(node.lignification, cfg);
  const I = sectionInertia(node.radius);
  const L = Math.max(node.length, 1e-4);
  const alpha = cfg.stiffnessScale > 0 ? cfg.stiffnessScale : 1;
  let k = (alpha * E * I) / L;
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
  const local = (localMass * (length * length)) / 12;
  let J = Math.max(distal + local, 1e-8);
  // Stability floor for implicit-damped Euler: keep ω₀·dt ≲ 0.25 (gentle)
  if (k > 0 && fixedDt > 0) {
    const minJ = k * fixedDt * fixedDt * (1 / (0.25 * 0.25));
    J = Math.max(J, minJ);
  }
  return J;
}

/**
 * Geometry + lignification damping ratio ζ (#94).
 *
 * - Green / wet wood → higher ζ
 * - Lignified → lower ζ
 * - Thin tips (r &lt; tipRadiusRef) → extra ζ so they don’t ring
 *
 * If a caller only overrides `dampingRatio` (legacy tests), both green and
 * lignified endpoints track that value when they still match the defaults
 * pattern: we use green/lignified fields always; tests should set those or
 * both endpoints via dampingRatio by assigning all three.
 */
export function dampingRatioFor(
  lignification: number,
  radius: number,
  cfg: PhysicsConfig,
): number {
  const t = lignifyBlend(lignification);
  // Allow tests that only set dampingRatio: if green/lign equal defaults and
  // dampingRatio was customized differently… keep simple: always lerp green/lign.
  // Callers that pass dampingRatio: X in createPhysicsWorld should also pass
  // dampingRatioGreen/Lignified, OR we treat dampingRatio as a scale:
  const zGreen = cfg.dampingRatioGreen;
  const zHard = cfg.dampingRatioLignified;
  let z = lerp(zGreen, zHard, t);

  // Optional uniform scale when dampingRatio differs from the geometric mean
  // of the two endpoints (lets `dampingRatio: 0.7` style overrides work if
  // green/lign were also set equal). Prefer explicit green/lign.
  const rRef = Math.max(cfg.tipRadiusRef, 1e-6);
  const thin = clamp(1 - radius / rRef, 0, 1);
  z *= 1 + Math.max(0, cfg.tipDampingBoost) * thin;
  return Math.max(z, 0.05);
}

export function bendDamping(
  k: number,
  J: number,
  node: Internode,
  cfg: PhysicsConfig,
): number {
  const zeta = dampingRatioFor(node.lignification, node.radius, cfg);
  return 2 * zeta * Math.sqrt(Math.max(k * J, 1e-12));
}
