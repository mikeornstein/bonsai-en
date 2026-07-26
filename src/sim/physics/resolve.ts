import { clamp, cross, dot, quatIdentity, sub } from '../math';
import type { NodeWorld } from '../tree';
import type { Internode, NodeId, Quat, TreeState, Vec3 } from '../types';
import { jointAxes } from './frames';
import type { Contact, PhysicsWorld } from './types';

/**
 * Project joint angles to reduce contact penetrations.
 * Uses a simple angular Jacobian: ∂p/∂θ ≈ axis × (p − jointBase).
 * Prefers adjusting the more distal / less stiff joint of a pair.
 */
export function resolveContacts(
  tree: TreeState,
  world: PhysicsWorld,
  frames: Map<NodeId, NodeWorld>,
  contacts: Contact[],
): void {
  if (!contacts.length) return;
  const cfg = world.config;
  const bias = cfg.contactBias;

  // Parent world map for axes
  const parentWorld = new Map<NodeId, Quat>();
  parentWorld.set(tree.rootId, quatIdentity());
  for (const [id, frame] of frames) {
    const node = tree.nodes[id];
    if (!node) continue;
    for (const c of node.children) {
      parentWorld.set(c, frame.worldOrientation);
    }
  }

  for (let iter = 0; iter < cfg.contactIterations; iter++) {
    let maxDepth = 0;
    for (const c of contacts) {
      if (c.depth <= cfg.contactSlop) continue;
      maxDepth = Math.max(maxDepth, c.depth);
      // Soft correction — only a fraction of penetration per pass
      const corr = (c.depth - cfg.contactSlop) * Math.min(1, bias);

      if (c.bId === null) {
        // Static: push only A
        applySeparation(tree, world, frames, parentWorld, c.aId, c.point, c.normal, corr);
      } else {
        // Split correction by inverse stiffness
        const ja = world.joints.get(c.aId);
        const jb = world.joints.get(c.bId);
        const invA = ja ? 1 / Math.max(ja.k, 1e-3) : 0;
        const invB = jb ? 1 / Math.max(jb.k, 1e-3) : 0;
        const sum = invA + invB || 1;
        const wA = invA / sum;
        const wB = invB / sum;
        if (wA > 1e-6) {
          applySeparation(
            tree,
            world,
            frames,
            parentWorld,
            c.aId,
            c.point,
            c.normal,
            corr * wA,
          );
        }
        if (wB > 1e-6) {
          // Opposite normal for B
          applySeparation(
            tree,
            world,
            frames,
            parentWorld,
            c.bId,
            c.point,
            [-c.normal[0], -c.normal[1], -c.normal[2]],
            corr * wB,
          );
        }
      }
    }
    if (maxDepth < cfg.contactSlop * 2) break;
  }

  // Kill closing normal velocity on free joints involved
  for (const c of contacts) {
    dampClosing(world, c.aId, 0.55);
    if (c.bId) dampClosing(world, c.bId, 0.55);
  }
}

function dampClosing(world: PhysicsWorld, id: NodeId, factor: number): void {
  const j = world.joints.get(id);
  if (!j || j.parentId === null) return;
  j.omegaX *= factor;
  j.omegaZ *= factor;
}

/**
 * Move contact point of `nodeId` along `normal` by adjusting its own joint
 * and walking toward root if needed.
 */
function applySeparation(
  tree: TreeState,
  world: PhysicsWorld,
  frames: Map<NodeId, NodeWorld>,
  parentWorld: Map<NodeId, Quat>,
  nodeId: NodeId,
  point: Vec3,
  normal: Vec3,
  distance: number,
): void {
  if (distance <= 0) return;
  let remaining = distance;
  let cur: NodeId | null = nodeId;
  let hops = 0;

  while (cur && remaining > 1e-7 && hops < 8) {
    const joint = world.joints.get(cur);
    const node: Internode | undefined = tree.nodes[cur];
    if (!joint || !node || node.parentId === null) {
      cur = node ? node.parentId : null;
      hops += 1;
      continue;
    }

    const frame = frames.get(cur);
    if (!frame) break;
    const pw = parentWorld.get(cur) ?? quatIdentity();
    const { ax, az } = jointAxes(pw, node.orientation);
    const r = sub(point, frame.base);
    const jx = cross(ax, r); // ∂p/∂θx
    const jz = cross(az, r);

    const dx = dot(jx, normal);
    const dz = dot(jz, normal);
    const denom = dx * dx + dz * dz;
    if (denom < 1e-12) {
      cur = node.parentId;
      hops += 1;
      continue;
    }

    // Solve min |δθ| s.t. dx δθx + dz δθz ≈ remaining
    const inv = remaining / denom;
    let dtx = dx * inv;
    let dtz = dz * inv;

    // Limit single-step angle change (very soft contact pushes)
    const maxStep = 0.001;
    dtx = clamp(dtx, -maxStep, maxStep);
    dtz = clamp(dtz, -maxStep, maxStep);

    joint.thetaX = clamp(
      joint.thetaX + dtx,
      -world.config.maxDeflectionRad,
      world.config.maxDeflectionRad,
    );
    joint.thetaZ = clamp(
      joint.thetaZ + dtz,
      -world.config.maxDeflectionRad,
      world.config.maxDeflectionRad,
    );

    const applied = dx * dtx + dz * dtz;
    remaining -= applied;
    // Also walk to parent for remaining
    cur = node.parentId;
    hops += 1;
  }
}
