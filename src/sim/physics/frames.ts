import {
  quatFromAxisAngle,
  quatIdentity,
  quatMultiply,
  quatNormalize,
  quatRotateVec3,
  vec3,
} from '../math';
import type { NodeWorld } from '../tree';
import type { NodeId, Quat, TreeState, Vec3 } from '../types';
import type { JointRuntime, PhysicsWorld } from './types';

const LOCAL_X: Vec3 = [1, 0, 0];
const LOCAL_Z: Vec3 = [0, 0, 1];
const LOCAL_UP: Vec3 = [0, 1, 0];

/** Deflection quaternion from small-angle bend DOFs. */
export function deflectionQuat(thetaX: number, thetaZ: number): Quat {
  const qx = quatFromAxisAngle(LOCAL_X, thetaX);
  const qz = quatFromAxisAngle(LOCAL_Z, thetaZ);
  return quatNormalize(quatMultiply(qx, qz));
}

/**
 * World frames using rest orientations × elastic deflection.
 * Root has no elastic DOF (clamped).
 */
export function computeLiveWorldFrames(
  tree: TreeState,
  world: PhysicsWorld,
): Map<NodeId, NodeWorld> {
  const out = new Map<NodeId, NodeWorld>();
  const root = tree.nodes[tree.rootId];
  if (!root) return out;

  const visit = (id: NodeId, base: Vec3, parentWorld: Quat) => {
    const node = tree.nodes[id];
    if (!node) return;
    const joint = world.joints.get(id);
    let local = node.orientation;
    if (joint && node.parentId !== null) {
      local = quatMultiply(
        node.orientation,
        deflectionQuat(joint.thetaX, joint.thetaZ),
      );
    }
    const worldOrientation = quatMultiply(parentWorld, local);
    const dir = quatRotateVec3(worldOrientation, LOCAL_UP);
    const tip: Vec3 = [
      base[0] + dir[0] * node.length,
      base[1] + dir[1] * node.length,
      base[2] + dir[2] * node.length,
    ];
    out.set(id, { base, tip, dir, worldOrientation });
    for (const childId of node.children) {
      visit(childId, tip, worldOrientation);
    }
  };

  visit(root.id, vec3(0, 0, 0), quatIdentity());
  return out;
}

/** Midpoint COM of a segment in live frames. */
export function segmentCom(frame: NodeWorld): Vec3 {
  return [
    (frame.base[0] + frame.tip[0]) * 0.5,
    (frame.base[1] + frame.tip[1]) * 0.5,
    (frame.base[2] + frame.tip[2]) * 0.5,
  ];
}

/** Local X/Z axes of the rest frame (parentWorld * restOri) for torque projection. */
export function jointAxes(
  parentWorld: Quat,
  restOrientation: Quat,
): { ax: Vec3; az: Vec3 } {
  const restWorld = quatMultiply(parentWorld, restOrientation);
  return {
    ax: quatRotateVec3(restWorld, LOCAL_X),
    az: quatRotateVec3(restWorld, LOCAL_Z),
  };
}

export function jointFromWorld(world: PhysicsWorld, id: NodeId): JointRuntime | undefined {
  return world.joints.get(id);
}
