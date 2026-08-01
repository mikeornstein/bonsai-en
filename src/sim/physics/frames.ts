import {
  length,
  normalize,
  quatFromAxisAngle,
  quatIdentity,
  quatMultiply,
  quatNormalize,
  quatRotateVec3,
  scale,
  sub,
  vec3,
} from '../math';
import type { NodeWorld } from '../tree';
import type { NodeId, Quat, TreeState, Vec3 } from '../types';
import type { JointRuntime, PhysicsWorld } from './types';

const LOCAL_X: Vec3 = [1, 0, 0];
const LOCAL_Z: Vec3 = [0, 0, 1];
const LOCAL_UP: Vec3 = [0, 1, 0];

/** Path samples per internode (inclusive endpoints) for smooth render (#94). */
export const SEGMENT_PATH_SAMPLES = 5;

/** Hermite tangent scale relative to segment length (0.5 ≈ Catmull-ish). */
const HERMITE_TENSION = 0.55;

/** Deflection quaternion from small-angle bend DOFs. */
export function deflectionQuat(thetaX: number, thetaZ: number): Quat {
  const qx = quatFromAxisAngle(LOCAL_X, thetaX);
  const qz = quatFromAxisAngle(LOCAL_Z, thetaZ);
  return quatNormalize(quatMultiply(qx, qz));
}

/**
 * Cubic Hermite sample: p(t) = h00 P0 + h10 T0 + h01 P1 + h11 T1, t∈[0,1].
 * T0/T1 are full tangent vectors (not unit).
 */
export function hermitePoint(
  p0: Vec3,
  p1: Vec3,
  t0: Vec3,
  t1: Vec3,
  t: number,
): Vec3 {
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return [
    h00 * p0[0] + h10 * t0[0] + h01 * p1[0] + h11 * t1[0],
    h00 * p0[1] + h10 * t0[1] + h01 * p1[1] + h11 * t1[1],
    h00 * p0[2] + h10 * t0[2] + h01 * p1[2] + h11 * t1[2],
  ];
}

/** Sample a cubic Hermite curve from base→tip (inclusive). */
export function sampleHermitePath(
  p0: Vec3,
  p1: Vec3,
  t0: Vec3,
  t1: Vec3,
  samples: number,
): Vec3[] {
  const n = Math.max(2, samples | 0);
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    out.push(hermitePoint(p0, p1, t0, t1, t));
  }
  // Force exact endpoints
  out[0] = [p0[0], p0[1], p0[2]];
  out[n - 1] = [p1[0], p1[1], p1[2]];
  return out;
}

/**
 * World frames using rest orientations × elastic deflection.
 * Root has no elastic DOF (clamped).
 *
 * After the joint graph is built, each frame gets a Hermite `path` so render
 * can draw continuous curvature along the internode (#94) while dynamics stay
 * joint-based.
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
  attachHermitePaths(tree, out);
  return out;
}

/**
 * Attach smooth base→tip polylines using neighbor directions as Hermite
 * tangents (parent dir in, average child dir out). Chord endpoints stay exact
 * so joint bases/tips and collision capsules remain consistent.
 */
export function attachHermitePaths(
  tree: TreeState,
  frames: Map<NodeId, NodeWorld>,
  samples = SEGMENT_PATH_SAMPLES,
): void {
  for (const [id, frame] of frames) {
    const node = tree.nodes[id];
    if (!node) continue;
    const L = Math.max(length(sub(frame.tip, frame.base)), 1e-6);

    let dirIn = frame.dir;
    if (node.parentId) {
      const pf = frames.get(node.parentId);
      if (pf && length(pf.dir) > 1e-8) dirIn = pf.dir;
    }
    dirIn = normalize(dirIn);

    let dirOut = frame.dir;
    if (node.children.length > 0) {
      let ax = 0;
      let ay = 0;
      let az = 0;
      let n = 0;
      for (const c of node.children) {
        const cf = frames.get(c);
        if (!cf) continue;
        ax += cf.dir[0];
        ay += cf.dir[1];
        az += cf.dir[2];
        n += 1;
      }
      if (n > 0) {
        dirOut = normalize([ax / n, ay / n, az / n]);
      } else {
        dirOut = normalize(frame.dir);
      }
    } else {
      dirOut = normalize(frame.dir);
    }

    const t0 = scale(dirIn, L * HERMITE_TENSION);
    const t1 = scale(dirOut, L * HERMITE_TENSION);
    frame.path = sampleHermitePointPath(frame.base, frame.tip, t0, t1, samples);
  }
}

function sampleHermitePointPath(
  p0: Vec3,
  p1: Vec3,
  t0: Vec3,
  t1: Vec3,
  samples: number,
): Vec3[] {
  return sampleHermitePath(p0, p1, t0, t1, samples);
}

/** Midpoint COM of a segment in live frames (chord midpoint). */
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

export function jointFromWorld(
  world: PhysicsWorld,
  id: NodeId,
): JointRuntime | undefined {
  return world.joints.get(id);
}
