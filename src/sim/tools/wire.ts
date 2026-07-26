import {
  clamp,
  normalize,
  quatCopy,
  quatFromAxisAngle,
  quatRotateVec3,
  quatSlerp,
} from '../math';
import { bendNodeToward, computeWorldFrames } from '../tree';
import type { NodeId, Quat, TreeState, Vec3 } from '../types';

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

export function bendWiredNode(
  tree: TreeState,
  nodeId: NodeId,
  worldDir: Vec3,
): WireResult {
  const node = tree.nodes[nodeId];
  if (!node) return { ok: false, message: 'No branch selected' };
  if (!node.wire) {
    // Auto-apply wire when bending in wire tool
    applyWire(tree, nodeId);
  }
  if (!node.living) return { ok: false, message: 'Cannot bend dead wood' };

  const frames = computeWorldFrames(tree);
  const frame = frames.get(nodeId);
  if (!frame) return { ok: false, message: 'Invalid node' };

  const len = Math.hypot(worldDir[0], worldDir[1], worldDir[2]) || 1;
  const dir: Vec3 = [
    worldDir[0] / len,
    worldDir[1] / len,
    worldDir[2] / len,
  ];

  bendNodeToward(tree, nodeId, dir);
  if (node.wire) {
    node.wire.tension = clamp(node.wire.tension + 0.02, 0, 1);
  }
  return { ok: true, message: 'Bent' };
}

export function isWired(tree: TreeState, nodeId: NodeId): boolean {
  return Boolean(tree.nodes[nodeId]?.wire);
}
