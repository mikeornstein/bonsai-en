import { TREE_SOIL_Y } from '../env/potBounds';
import { add, cross, dot, length, normalize, scale, sub, vec3 } from '../math';
import type { NodeWorld } from '../tree';
import type { NodeId, TreeState, Vec3 } from '../types';
import type { Contact, PhysicsWorld } from './types';

/** Closest points between two segments (a0-a1) and (b0-b1). */
export function closestPointsSegments(
  a0: Vec3,
  a1: Vec3,
  b0: Vec3,
  b1: Vec3,
): { pa: Vec3; pb: Vec3; dist: number } {
  const d1 = sub(a1, a0);
  const d2 = sub(b1, b0);
  const r = sub(a0, b0);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);

  let s: number;
  let t: number;

  if (a <= 1e-14 && e <= 1e-14) {
    return { pa: a0, pb: b0, dist: length(sub(a0, b0)) };
  }
  if (a <= 1e-14) {
    s = 0;
    t = clamp01(f / e);
  } else {
    const c = dot(d1, r);
    if (e <= 1e-14) {
      t = 0;
      s = clamp01(-c / a);
    } else {
      const b = dot(d1, d2);
      const denom = a * e - b * b;
      s = denom !== 0 ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }

  const pa = add(a0, scale(d1, s));
  const pb = add(b0, scale(d2, t));
  return { pa, pb, dist: length(sub(pa, pb)) };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function areAdjacent(
  tree: TreeState,
  a: NodeId,
  b: NodeId,
): boolean {
  const na = tree.nodes[a];
  const nb = tree.nodes[b];
  if (!na || !nb) return true;
  // Parent–child share an endpoint
  if (na.parentId === b || nb.parentId === a) return true;
  // Siblings share a joint — capsule bases coincide → permanent "penetration"
  if (na.parentId && na.parentId === nb.parentId) return true;
  // Uncle/niece one hop (child of parent's sibling)
  if (na.parentId && tree.nodes[na.parentId]?.parentId === b) return true;
  if (nb.parentId && tree.nodes[nb.parentId]?.parentId === a) return true;
  return false;
}

/**
 * Gather capsule–capsule and capsule–env contacts.
 * Penetration depth > 0 means overlap that must be resolved.
 */
export function detectContacts(
  tree: TreeState,
  world: PhysicsWorld,
  frames: Map<NodeId, NodeWorld>,
): Contact[] {
  const contacts: Contact[] = [];
  const ids = [...world.joints.keys()].filter((id) => {
    const n = tree.nodes[id];
    return n && n.living && n.parentId !== null && n.length > 1e-6;
  });

  // Self-collision (broadphase: all pairs — n≤MAX_TREE_NODES)
  for (let i = 0; i < ids.length; i++) {
    const aId = ids[i];
    const fa = frames.get(aId);
    const ja = world.joints.get(aId);
    if (!fa || !ja) continue;
    for (let j = i + 1; j < ids.length; j++) {
      const bId = ids[j];
      if (areAdjacent(tree, aId, bId)) continue;
      // Skip if one is ancestor of the other (chain connected)
      if (isAncestor(tree, aId, bId) || isAncestor(tree, bId, aId)) continue;

      const fb = frames.get(bId);
      const jb = world.joints.get(bId);
      if (!fb || !jb) continue;

      const { pa, pb, dist } = closestPointsSegments(
        fa.base,
        fa.tip,
        fb.base,
        fb.tip,
      );
      const minDist = ja.radius + jb.radius;
      // Ignore near-endpoint grazes (joint collars) — only mid-span crossings
      const ta = paramOnSegment(fa.base, fa.tip, pa);
      const tb = paramOnSegment(fb.base, fb.tip, pb);
      if (ta < 0.12 || ta > 0.95 || tb < 0.12 || tb > 0.95) continue;

      if (dist < minDist - world.config.contactSlop) {
        const depth = minDist - dist;
        let normal: Vec3;
        if (dist > 1e-9) {
          normal = normalize(sub(pb, pa));
        } else {
          const midA = scale(add(fa.base, fa.tip), 0.5);
          const midB = scale(add(fb.base, fb.tip), 0.5);
          const d = sub(midB, midA);
          normal = length(d) > 1e-9 ? normalize(d) : vec3(1, 0, 0);
        }
        contacts.push({
          aId,
          bId,
          normal,
          depth,
          point: scale(add(pa, pb), 0.5),
        });
      }
    }
  }

  // Environment: soil plane only (no pot-wall collisions — branches may hang past the rim)
  for (const id of ids) {
    const f = frames.get(id);
    const j = world.joints.get(id);
    if (!f || !j) continue;

    const samples: Vec3[] = [
      f.base,
      scale(add(f.base, f.tip), 0.5),
      f.tip,
    ];
    const slop = world.config.contactSlop;
    for (const p of samples) {
      // Soil: only when clearly buried past slop (avoids perpetual micro-contact)
      const yClear = p[1] - j.radius;
      const soilPen = TREE_SOIL_Y - yClear;
      if (soilPen > slop) {
        contacts.push({
          aId: id,
          bId: null,
          normal: [0, 1, 0],
          depth: soilPen,
          point: [p[0], TREE_SOIL_Y, p[2]],
          env: 'soil',
        });
      }
    }
  }

  return contacts;
}

function isAncestor(tree: TreeState, anc: NodeId, desc: NodeId): boolean {
  let cur: NodeId | null = desc;
  while (cur) {
    if (cur === anc) return true;
    cur = tree.nodes[cur]?.parentId ?? null;
  }
  return false;
}

/** Parameter t∈[0,1] of point p along segment a→b. */
function paramOnSegment(a: Vec3, b: Vec3, p: Vec3): number {
  const ab = sub(b, a);
  const ap = sub(p, a);
  const den = dot(ab, ab);
  if (den < 1e-14) return 0;
  return clamp01(dot(ap, ab) / den);
}

/** Unused helper kept for resolve jacobian experiments. */
export function contactJacobianHint(
  jointBase: Vec3,
  point: Vec3,
  axis: Vec3,
): Vec3 {
  return cross(axis, sub(point, jointBase));
}
