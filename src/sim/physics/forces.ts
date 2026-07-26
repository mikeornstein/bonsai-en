import {
  cross,
  dot,
  quatIdentity,
  scale,
  sub,
  vec3,
} from '../math';
import type { NodeWorld } from '../tree';
import type { NodeId, Quat, TreeState, Vec3 } from '../types';
import { jointAxes, segmentCom } from './frames';
import type { ExternalForces, PhysicsWorld } from './types';

export interface JointTorque {
  tx: number;
  tz: number;
}

/**
 * Accumulate spring, damping, gravity, and camera torques for each free joint.
 */
export function computeJointTorques(
  tree: TreeState,
  world: PhysicsWorld,
  frames: Map<NodeId, NodeWorld>,
  external: ExternalForces,
): Map<NodeId, JointTorque> {
  const out = new Map<NodeId, JointTorque>();
  const cfg = world.config;
  const gVec: Vec3 = external.gravity
    ? [0, -cfg.gravity, 0]
    : [0, 0, 0];

  // Camera fictitious acceleration field
  const aCam = external.enabled
    ? scale(external.cameraAccel, -cfg.cameraForceGain)
    : vec3();
  const alpha = external.enabled
    ? scale(external.cameraAlpha, cfg.cameraForceGain)
    : vec3();

  // Parent world orientations for axis projection
  const parentWorld = new Map<NodeId, Quat>();
  parentWorld.set(tree.rootId, quatIdentity());

  for (const [id, frame] of frames) {
    const node = tree.nodes[id];
    if (!node) continue;
    for (const c of node.children) {
      parentWorld.set(c, frame.worldOrientation);
    }
  }

  // Precompute force at each COM: m*(g + a_cam + alpha × r)
  const forceAt = new Map<NodeId, Vec3>();
  for (const [id, joint] of world.joints) {
    if (joint.mass <= 0) {
      forceAt.set(id, vec3());
      continue;
    }
    const frame = frames.get(id);
    if (!frame) {
      forceAt.set(id, vec3());
      continue;
    }
    const com = segmentCom(frame);
    const aAlpha = cross(alpha, com);
    forceAt.set(id, [
      joint.mass * (gVec[0] + aCam[0] + aAlpha[0]),
      joint.mass * (gVec[1] + aCam[1] + aAlpha[1]),
      joint.mass * (gVec[2] + aCam[2] + aAlpha[2]),
    ]);
  }

  for (const [id, joint] of world.joints) {
    const node = tree.nodes[id];
    if (!node || node.parentId === null) {
      out.set(id, { tx: 0, tz: 0 });
      continue;
    }

    // Spring + damping
    let tx = -joint.k * joint.thetaX - joint.c * joint.omegaX;
    let tz = -joint.k * joint.thetaZ - joint.c * joint.omegaZ;

    const base = frames.get(id)?.base;
    const pw = parentWorld.get(id) ?? quatIdentity();
    const { ax, az } = jointAxes(pw, node.orientation);

    if (base) {
      // Torque from this node + all descendants' forces about joint base
      const stack = [id];
      const seen = new Set<string>();
      while (stack.length) {
        const cid = stack.pop()!;
        if (seen.has(cid)) continue;
        seen.add(cid);
        const cNode = tree.nodes[cid];
        if (!cNode) continue;
        const f = forceAt.get(cid);
        const fr = frames.get(cid);
        if (f && fr) {
          const com = segmentCom(fr);
          const r = sub(com, base);
          const tau = cross(r, f);
          tx += dot(tau, ax);
          tz += dot(tau, az);
        }
        for (const ch of cNode.children) stack.push(ch);
      }
    }

    out.set(id, { tx, tz });
  }

  return out;
}
