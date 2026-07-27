import {
  clamp,
  cross,
  dot,
  length,
  normalize,
  quatCopy,
  quatFromAxisAngle,
  quatRotateVec3,
  quatSlerp,
} from '../math';
import { bendNodeToward, computeWorldFrames } from '../tree';
import type { Internode, NodeId, Quat, TreeState, Vec3 } from '../types';

export interface WireResult {
  ok: boolean;
  message: string;
}

/**
 * Wire bend feel constants (viewing-plane constrained drag).
 *
 * At default FOV, ~0.28° of branch tip swing per screen pixel before damping.
 * After BEND_DAMPING (0.55), effective feel is ~0.15°/px. Each pointermove
 * event is also capped at BEND_MAX_DEG_PER_EVENT so fast flicks cannot flip
 * a limb.
 */
export const BEND_DEG_PER_PIXEL = 0.28;
/** Fraction of raw pixel delta applied (soft feel). */
export const BEND_DAMPING = 0.55;
/** Hard cap on degrees applied from a single pointermove sample. */
export const BEND_MAX_DEG_PER_EVENT = 3.5;

/**
 * Minimum bend-radius knobs (global; species can override via params).
 *
 * Arc model: max joint angle ≈ length / R_min.
 * R_min grows with wood radius and lignification so thick / set wood cannot
 * form a single-joint kink under wire drag.
 */
export const MIN_RADIUS_GREEN_FACTOR = 6;
/** Extra R/r scaled by smoothstep(lignification). Fully lignified ≈ green + this. */
export const MIN_RADIUS_LIGNIFY_EXTRA = 10;
/** Absolute floor on bend radius (m) — even thin twigs. */
export const MIN_RADIUS_ABS_M = 0.005;
/** Hard ceiling on joint turn regardless of thin/short segments (rad ≈ 48°). */
export const HARD_MAX_JOINT_ANGLE = (48 * Math.PI) / 180;
/**
 * Fraction of residual bend (after primary joint cap) spread to parent / primary
 * child so continuous trunks form a smooth arc instead of one capped kink.
 */
export const BEND_SPREAD = 0.55;
/** Max off-axis angle (local) for a child to count as primary-chain continuation. */
export const PRIMARY_CHAIN_MAX_OFF_AXIS = 0.45;

export interface BendRadiusParams {
  greenRadiusFactor?: number;
  lignifyRadiusExtra?: number;
  absMinRadius?: number;
  hardMaxAngle?: number;
  /** Residual spread to parent/child [0, 1]. 0 = only constrain primary node. */
  spread?: number;
}

/** Smoothstep lignification blend (matches physics youngModulus curve). */
function lignifyBlend(lignification: number): number {
  const t = clamp(lignification, 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Minimum radius of curvature (m) for a segment under wire training.
 * Thicker and more lignified wood requires a larger arc.
 */
export function minBendRadiusM(
  radius: number,
  lignification: number,
  params?: BendRadiusParams,
): number {
  const g = params?.greenRadiusFactor ?? MIN_RADIUS_GREEN_FACTOR;
  const lExtra = params?.lignifyRadiusExtra ?? MIN_RADIUS_LIGNIFY_EXTRA;
  const absMin = params?.absMinRadius ?? MIN_RADIUS_ABS_M;
  const factor = g + lExtra * lignifyBlend(lignification);
  return Math.max(absMin, Math.max(radius, 1e-5) * factor);
}

/**
 * Max allowed angle (radians) between a segment's world axis and its parent's
 * world axis — arc length / min radius, hard-capped.
 */
export function maxJointAngleRad(
  lengthM: number,
  radius: number,
  lignification: number,
  params?: BendRadiusParams,
): number {
  const R = minBendRadiusM(radius, lignification, params);
  const L = Math.max(lengthM, 1e-4);
  const fromCurvature = L / R;
  const hard = params?.hardMaxAngle ?? HARD_MAX_JOINT_ANGLE;
  return Math.min(fromCurvature, hard);
}

/** Angle between two unit-ish directions (radians). */
export function dirAngle(a: Vec3, b: Vec3): number {
  return Math.acos(clamp(dot(normalize(a), normalize(b)), -1, 1));
}

/**
 * Rotate `from` toward `to` by at most `maxAngle` radians.
 * Pure; returns a unit vector.
 */
export function rotateDirToward(from: Vec3, to: Vec3, maxAngle: number): Vec3 {
  const f = normalize(from);
  const t = normalize(to);
  if (!(maxAngle > 0)) return f;
  const ang = dirAngle(f, t);
  if (ang < 1e-9) return f;
  if (ang <= maxAngle + 1e-9) return t;

  let axis = cross(f, t);
  if (length(axis) < 1e-8) {
    // Near-opposite: pick a stable perpendicular
    axis = Math.abs(f[1]) < 0.9 ? cross(f, [0, 1, 0]) : cross(f, [1, 0, 0]);
  }
  return normalize(quatRotateVec3(quatFromAxisAngle(normalize(axis), maxAngle), f));
}

/**
 * Clamp `dir` so its angle from `axis` does not exceed `maxAngle`
 * (cone constraint around the parent axis).
 */
export function clampDirToCone(axis: Vec3, dir: Vec3, maxAngle: number): Vec3 {
  return rotateDirToward(axis, dir, maxAngle);
}

/** Off-axis angle of a child's local orientation from parent +Y (radians). */
function localOffAxis(orient: Quat): number {
  const dir = quatRotateVec3(orient, [0, 1, 0]);
  return Math.acos(clamp(dir[1], -1, 1));
}

/**
 * Primary-chain continuation child: living child with smallest local off-axis
 * angle, only if roughly collinear with the parent axis.
 */
export function primaryChildId(tree: TreeState, nodeId: NodeId): NodeId | null {
  const node = tree.nodes[nodeId];
  if (!node?.children.length) return null;
  let best: NodeId | null = null;
  let bestOff = Infinity;
  for (const cid of node.children) {
    const child = tree.nodes[cid];
    if (!child?.living) continue;
    const off = localOffAxis(child.orientation);
    if (off < bestOff) {
      bestOff = off;
      best = cid;
    }
  }
  if (best === null || bestOff > PRIMARY_CHAIN_MAX_OFF_AXIS) return null;
  return best;
}

/**
 * Walk the primary continuum from `nodeId` up `upHops` and down `downHops`.
 * Returns base→tip order including the start node.
 */
export function primaryChainIds(
  tree: TreeState,
  nodeId: NodeId,
  upHops = 2,
  downHops = 2,
): NodeId[] {
  if (!tree.nodes[nodeId]) return [];
  const up: NodeId[] = [];
  let cur: NodeId | null = nodeId;
  for (let i = 0; i < upHops; i++) {
    const n: Internode | undefined = cur ? tree.nodes[cur] : undefined;
    if (!n?.parentId) break;
    // Only climb if this node is (approx) the primary child of its parent
    const primary = primaryChildId(tree, n.parentId);
    if (primary !== cur && n.parentId) {
      // Still allow climbing one hop for trunk nodes that are the sole child
      const parent = tree.nodes[n.parentId];
      if (!parent || parent.children.length > 1) break;
    }
    up.push(n.parentId);
    cur = n.parentId;
  }
  up.reverse();

  const down: NodeId[] = [];
  cur = nodeId;
  for (let i = 0; i < downHops; i++) {
    const next = primaryChildId(tree, cur);
    if (!next) break;
    down.push(next);
    cur = next;
  }
  return [...up, nodeId, ...down];
}

/**
 * Set a node's world axis toward `desiredWorldDir`, clamping the joint angle
 * vs parent (or world +Y for root) to the min-bend-radius limit.
 * Returns the achieved world direction.
 */
export function setNodeDirConstrained(
  tree: TreeState,
  nodeId: NodeId,
  desiredWorldDir: Vec3,
  params?: BendRadiusParams,
): Vec3 {
  const node = tree.nodes[nodeId];
  if (!node?.living) return normalize(desiredWorldDir);

  const frames = computeWorldFrames(tree);
  const frame = frames.get(nodeId);
  if (!frame) return normalize(desiredWorldDir);

  let parentDir: Vec3 = [0, 1, 0];
  if (node.parentId) {
    const pf = frames.get(node.parentId);
    if (pf) parentDir = pf.dir;
  }

  const maxAng = maxJointAngleRad(
    node.length,
    node.radius,
    node.lignification,
    params,
  );
  const capped = clampDirToCone(parentDir, desiredWorldDir, maxAng);
  bendNodeToward(tree, nodeId, capped);

  // Re-read achieved world dir (bendNodeToward wrote local orientation)
  const frames2 = computeWorldFrames(tree);
  return frames2.get(nodeId)?.dir ?? capped;
}

/**
 * Install wire on a continuous primary-chain run around `nodeId`
 * (paint-wire along trunk/branch continuum).
 */
export function applyWireRun(
  tree: TreeState,
  nodeId: NodeId,
  opts?: { upHops?: number; downHops?: number },
): WireResult {
  const node = tree.nodes[nodeId];
  if (!node) return { ok: false, message: 'No branch selected' };
  if (!node.living) return { ok: false, message: 'Cannot wire dead wood' };

  const chain = primaryChainIds(
    tree,
    nodeId,
    opts?.upHops ?? 2,
    opts?.downHops ?? 2,
  );
  let applied = 0;
  let already = 0;
  for (const id of chain) {
    const n = tree.nodes[id];
    if (!n?.living) continue;
    if (n.wire) {
      already += 1;
      continue;
    }
    const r = applyWire(tree, id);
    if (r.ok) applied += 1;
  }
  if (applied === 0 && already === 0) {
    return { ok: false, message: 'No wireable wood on run' };
  }
  if (applied === 0) {
    return { ok: true, message: 'Run already wired' };
  }
  const total = applied + already;
  return {
    ok: true,
    message:
      total > 1
        ? `Wire on ${total} segments · drag to shape arc`
        : 'Wire on · drag wood to shape',
  };
}

export function applyWire(tree: TreeState, nodeId: NodeId): WireResult {
  const node = tree.nodes[nodeId];
  if (!node) return { ok: false, message: 'No branch selected' };
  if (!node.living) return { ok: false, message: 'Cannot wire dead wood' };
  if (node.wire) return { ok: false, message: 'Already wired' };

  node.wire = {
    targetOrientation: quatCopy(node.orientation),
    installOrientation: quatCopy(node.orientation),
    setAmount: 0,
    installedPlantDay: tree.agePlantDays,
    tension: 0.4,
  };
  return { ok: true, message: 'Wire on · drag wood to shape' };
}

export function removeWire(tree: TreeState, nodeId: NodeId): WireResult {
  const node = tree.nodes[nodeId];
  if (!node) return { ok: false, message: 'No branch selected' };
  if (!node.wire) return { ok: false, message: 'No wire on this branch' };

  const setAmount = node.wire.setAmount;
  // Spring-back toward install orientation by unset portion
  const spring = 1 - setAmount;
  if (spring > 0.02) {
    node.orientation = quatSlerp(
      node.wire.targetOrientation,
      node.wire.installOrientation,
      spring * 0.85,
    ) as Quat;
  }
  delete node.wire;
  return {
    ok: true,
    message:
      setAmount > 0.85
        ? 'Wire off · wood holds the bend'
        : 'Wire off · wood springs back',
  };
}

/**
 * Convert screen-space drag (pixels) into damped yaw/pitch radians for
 * viewing-plane bend. Pure / unit-tested.
 *
 * - +dx (right) → positive yaw (rotate around camera up)
 * - +dy (down, screen Y) → positive pitch around camera right
 *   (right-hand: tip moves toward −cameraUp = down in the view)
 */
export function dampedBendRadians(
  dxPx: number,
  dyPx: number,
  opts?: {
    degPerPixel?: number;
    damping?: number;
    maxDegPerEvent?: number;
  },
): { yaw: number; pitch: number } {
  const degPer = opts?.degPerPixel ?? BEND_DEG_PER_PIXEL;
  const damp = opts?.damping ?? BEND_DAMPING;
  const maxDeg = opts?.maxDegPerEvent ?? BEND_MAX_DEG_PER_EVENT;

  const clampDeg = (d: number) => clamp(d, -maxDeg, maxDeg);
  const yawDeg = clampDeg(dxPx * degPer * damp);
  // Screen Y grows downward; positive pitch around camera-right drops tip in view.
  const pitchDeg = clampDeg(dyPx * degPer * damp);
  const toRad = Math.PI / 180;
  return { yaw: yawDeg * toRad, pitch: pitchDeg * toRad };
}

/**
 * Rotate a unit-ish world direction by viewing-plane yaw/pitch.
 * `cameraRight` / `cameraUp` should be unit world-space basis vectors.
 */
export function bendDirFromViewDelta(
  currentDir: Vec3,
  cameraRight: Vec3,
  cameraUp: Vec3,
  dxPx: number,
  dyPx: number,
  opts?: {
    degPerPixel?: number;
    damping?: number;
    maxDegPerEvent?: number;
  },
): Vec3 {
  const { yaw, pitch } = dampedBendRadians(dxPx, dyPx, opts);
  let dir = normalize(currentDir);
  const up = normalize(cameraUp);
  const right = normalize(cameraRight);

  if (Math.abs(yaw) > 1e-9) {
    dir = normalize(quatRotateVec3(quatFromAxisAngle(up, yaw), dir));
  }
  if (Math.abs(pitch) > 1e-9) {
    dir = normalize(quatRotateVec3(quatFromAxisAngle(right, pitch), dir));
  }

  return dir;
}

/** Human-readable set progress for HUD / selection. */
export function wireSetLabel(setAmount: number): string {
  const pct = Math.round(clamp(setAmount, 0, 1) * 100);
  if (pct >= 85) return `wire set (${pct}%)`;
  if (pct >= 35) return `wiring · ${pct}% set`;
  return `fresh wire · ${pct}% set`;
}

/**
 * Bend a wired node toward a world direction with min-bend-radius joint caps
 * and optional residual spread along the primary chain (smooth arc).
 */
export function bendWiredNode(
  tree: TreeState,
  nodeId: NodeId,
  worldDir: Vec3,
  params?: BendRadiusParams,
): WireResult {
  const node = tree.nodes[nodeId];
  if (!node) return { ok: false, message: 'No branch selected' };
  if (!node.wire) {
    // Auto-apply wire when bending in wire tool
    applyWire(tree, nodeId);
  }
  if (!node.living) return { ok: false, message: 'Cannot bend dead wood' };

  const frames0 = computeWorldFrames(tree);
  if (!frames0.get(nodeId)) return { ok: false, message: 'Invalid node' };

  const desired = normalize(worldDir);
  const spread = params?.spread ?? BEND_SPREAD;

  // Primary: constrain this joint to min-radius cone about parent axis
  const achieved = setNodeDirConstrained(tree, nodeId, desired, params);

  // Residual heading not achieved at this joint → soft arc on neighbors
  const residual = dirAngle(achieved, desired);
  if (residual > 1e-3 && spread > 0) {
    const parentId = node.parentId;
    if (parentId && tree.nodes[parentId]?.living) {
      const frames = computeWorldFrames(tree);
      const pDir = frames.get(parentId)?.dir;
      if (pDir) {
        const parentTarget = rotateDirToward(pDir, desired, residual * spread);
        setNodeDirConstrained(tree, parentId, parentTarget, params);
      }
    }
    const childId = primaryChildId(tree, nodeId);
    if (childId) {
      const frames = computeWorldFrames(tree);
      const cDir = frames.get(childId)?.dir;
      if (cDir) {
        const childTarget = rotateDirToward(cDir, desired, residual * spread);
        setNodeDirConstrained(tree, childId, childTarget, params);
      }
    }
  }

  if (node.wire) {
    node.wire.tension = clamp(node.wire.tension + 0.02, 0, 1);
  }
  return { ok: true, message: 'Bent' };
}

export function isWired(tree: TreeState, nodeId: NodeId): boolean {
  return Boolean(tree.nodes[nodeId]?.wire);
}

/**
 * Max angle (radians) between consecutive segment world axes along a node id list.
 * Useful for kink regression tests.
 */
export function maxConsecutiveAxisAngle(
  tree: TreeState,
  chainIds: NodeId[],
): number {
  const frames = computeWorldFrames(tree);
  let maxAng = 0;
  for (let i = 0; i < chainIds.length - 1; i++) {
    const a = frames.get(chainIds[i])?.dir;
    const b = frames.get(chainIds[i + 1])?.dir;
    if (!a || !b) continue;
    maxAng = Math.max(maxAng, dirAngle(a, b));
  }
  return maxAng;
}
