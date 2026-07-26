import { clamp, quatCopy, quatSlerp } from '../math';
import { bendNodeToward, computeWorldFrames } from '../tree';
import type { NodeId, Quat, TreeState, Vec3 } from '../types';

export interface WireResult {
  ok: boolean;
  message: string;
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
  return { ok: true, message: 'Wire on · drag to set the line' };
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

  // Limit extreme bends relative to parent direction
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
