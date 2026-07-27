import { describe, expect, it } from 'vitest';
import { quatIdentity } from '../math';
import { getSpecies } from '../species/juniper';
import {
  computeWorldFrames,
  createEmptyTree,
  createInternode,
  createSapling,
} from '../tree';
import type { NodeId, TreeState, Vec3 } from '../types';
import {
  BEND_DAMPING,
  BEND_DEG_PER_PIXEL,
  BEND_MAX_DEG_PER_EVENT,
  applyWire,
  applyWireRun,
  bendDirFromViewDelta,
  bendWiredNode,
  dampedBendRadians,
  dirAngle,
  maxConsecutiveAxisAngle,
  maxJointAngleRad,
  minBendRadiusM,
  primaryChainIds,
  primaryChildId,
  rotateDirToward,
  setNodeDirConstrained,
  wireSetLabel,
} from './wire';

describe('dampedBendRadians', () => {
  it('documents ~deg-per-pixel feel before damping', () => {
    // Raw (undamped) magnitude for 100px = 28° at BEND_DEG_PER_PIXEL
    expect(BEND_DEG_PER_PIXEL * 100).toBeCloseTo(28, 5);
  });

  it('scales with pixel travel and applies damping', () => {
    const { yaw, pitch } = dampedBendRadians(100, 0);
    const expectedDeg = 100 * BEND_DEG_PER_PIXEL * BEND_DAMPING;
    // 100px * 0.28 * 0.55 = 15.4°, but capped at max — so use min
    const capped = Math.min(expectedDeg, BEND_MAX_DEG_PER_EVENT);
    expect((yaw * 180) / Math.PI).toBeCloseTo(capped, 5);
    expect(pitch).toBeCloseTo(0, 8);
  });

  it('maps drag-down to positive pitch (tip toward −cameraUp)', () => {
    const { pitch } = dampedBendRadians(0, 40);
    expect(pitch).toBeGreaterThan(0);
  });

  it('caps extreme flicks per event', () => {
    const { yaw } = dampedBendRadians(10_000, 0);
    const deg = (Math.abs(yaw) * 180) / Math.PI;
    expect(deg).toBeLessThanOrEqual(BEND_MAX_DEG_PER_EVENT + 1e-9);
  });

  it('is antisymmetric in dx', () => {
    const a = dampedBendRadians(20, 0);
    const b = dampedBendRadians(-20, 0);
    expect(a.yaw).toBeCloseTo(-b.yaw, 8);
  });
});

describe('bendDirFromViewDelta', () => {
  const right: [number, number, number] = [1, 0, 0];
  const up: [number, number, number] = [0, 1, 0];
  const forward: [number, number, number] = [0, 0, 1];

  it('keeps length ~1 and stays near original for tiny moves', () => {
    const out = bendDirFromViewDelta(forward, right, up, 0.5, 0);
    const len = Math.hypot(out[0], out[1], out[2]);
    expect(len).toBeCloseTo(1, 5);
    // Small yaw around up → mostly still +Z with a bit of +X
    expect(out[2]).toBeGreaterThan(0.99);
    expect(out[0]).toBeGreaterThan(0);
  });

  it('drag right yaws around camera up (toward +X when looking +Z)', () => {
    const out = bendDirFromViewDelta(forward, right, up, 50, 0);
    expect(out[0]).toBeGreaterThan(0.05);
    expect(out[2]).toBeGreaterThan(0.5);
  });

  it('drag down pitches tip down (toward -Y)', () => {
    const out = bendDirFromViewDelta(forward, right, up, 0, 50);
    expect(out[1]).toBeLessThan(-0.05);
  });

  it('zero delta returns original direction (normalized)', () => {
    const out = bendDirFromViewDelta([0, 2, 0], right, up, 0, 0);
    expect(out[0]).toBeCloseTo(0, 6);
    expect(out[1]).toBeCloseTo(1, 6);
    expect(out[2]).toBeCloseTo(0, 6);
  });
});

describe('wireSetLabel', () => {
  it('labels fresh / wiring / set bands with percent', () => {
    expect(wireSetLabel(0)).toMatch(/fresh wire · 0%/);
    expect(wireSetLabel(0.4)).toMatch(/wiring · 40% set/);
    expect(wireSetLabel(0.9)).toMatch(/wire set \(90%\)/);
  });
});

describe('min bend radius / max joint angle', () => {
  it('increases radius of curvature with wood radius', () => {
    const thin = minBendRadiusM(0.003, 0.2);
    const thick = minBendRadiusM(0.02, 0.2);
    expect(thick).toBeGreaterThan(thin * 3);
  });

  it('increases radius of curvature with lignification', () => {
    const green = minBendRadiusM(0.01, 0.05);
    const hard = minBendRadiusM(0.01, 0.95);
    expect(hard).toBeGreaterThan(green * 1.4);
  });

  it('caps joint angle so thick lignified wood stays gentle (°/segment)', () => {
    // ~2 cm internode, 2 cm radius trunk, highly lignified
    const max = maxJointAngleRad(0.02, 0.02, 0.9);
    // R_min large → max angle small (well under 15°)
    expect(max).toBeLessThan((15 * Math.PI) / 180);
    expect(max).toBeGreaterThan(0);
  });

  it('allows larger joint angles on thin green laterals', () => {
    const thick = maxJointAngleRad(0.022, 0.018, 0.85);
    const thin = maxJointAngleRad(0.022, 0.0025, 0.15);
    expect(thin).toBeGreaterThan(thick * 2.5);
  });
});

describe('rotateDirToward / cone clamp', () => {
  it('returns target when within budget', () => {
    const from: Vec3 = [0, 1, 0];
    const to: Vec3 = [0.1, 0.995, 0];
    const out = rotateDirToward(from, to, 0.5);
    expect(dirAngle(out, to)).toBeLessThan(1e-5);
  });

  it('stops at maxAngle when target is farther', () => {
    const from: Vec3 = [0, 1, 0];
    const to: Vec3 = [1, 0, 0];
    const max = 0.3;
    const out = rotateDirToward(from, to, max);
    expect(dirAngle(from, out)).toBeCloseTo(max, 5);
  });
});

/** Straight vertical trunk for kink tests (controlled radius / lignify). */
function makeStraightTrunk(opts: {
  segments: number;
  length: number;
  radius: number;
  lignification: number;
}): { tree: TreeState; chain: NodeId[] } {
  const species = getSpecies('juniper-procumbens');
  const tree = createEmptyTree(species.id, 42);
  const chain: NodeId[] = [];
  let parentId: NodeId | null = null;
  for (let i = 0; i < opts.segments; i++) {
    const n = createInternode(
      tree,
      parentId,
      quatIdentity(),
      opts.length,
      opts.radius,
      species,
    );
    n.lignification = opts.lignification;
    n.ageDays = 100;
    if (i === 0) tree.rootId = n.id;
    chain.push(n.id);
    parentId = n.id;
  }
  return { tree, chain };
}

describe('curvature-constrained wire bend (#51)', () => {
  it('keeps thick trunk consecutive axis angles under species threshold after aggressive bend', () => {
    const length = 0.022;
    const radius = 0.018;
    const lignification = 0.85;
    const { tree, chain } = makeStraightTrunk({
      segments: 6,
      length,
      radius,
      lignification,
    });

    // Bend mid-trunk hard toward +X many times (harness-style absolute aim)
    const mid = chain[3];
    applyWire(tree, mid);
    const hard: Vec3 = [1, 0, 0];
    for (let i = 0; i < 40; i++) {
      bendWiredNode(tree, mid, hard);
    }

    const maxAng = maxConsecutiveAxisAngle(tree, chain);
    const threshold = maxJointAngleRad(length, radius, lignification);
    // Allow tiny float slack; joint cap must hold on every consecutive pair
    expect(maxAng).toBeLessThanOrEqual(threshold + 1e-4);

    // Document threshold is modest for thick wood (no 40° kink)
    expect((maxAng * 180) / Math.PI).toBeLessThan(20);
  });

  it('thin laterals remain more responsive than thick trunk', () => {
    const length = 0.02;

    const thick = makeStraightTrunk({
      segments: 4,
      length,
      radius: 0.016,
      lignification: 0.8,
    });
    const thin = makeStraightTrunk({
      segments: 4,
      length,
      radius: 0.0028,
      lignification: 0.15,
    });

    const thickMid = thick.chain[2];
    const thinMid = thin.chain[2];
    applyWire(thick.tree, thickMid);
    applyWire(thin.tree, thinMid);

    const hard: Vec3 = [1, 0.05, 0];
    for (let i = 0; i < 25; i++) {
      bendWiredNode(thick.tree, thickMid, hard);
      bendWiredNode(thin.tree, thinMid, hard);
    }

    const thickFrames = computeWorldFrames(thick.tree);
    const thinFrames = computeWorldFrames(thin.tree);
    const thickDir = thickFrames.get(thickMid)!.dir;
    const thinDir = thinFrames.get(thinMid)!.dir;
    const up: Vec3 = [0, 1, 0];

    const thickDeflect = dirAngle(up, thickDir);
    const thinDeflect = dirAngle(up, thinDir);

    // Thin wood reaches farther toward the hard target
    expect(thinDeflect).toBeGreaterThan(thickDeflect * 1.5);
    expect(thinDeflect).toBeGreaterThan((25 * Math.PI) / 180);
  });

  it('setNodeDirConstrained never exceeds max joint angle vs parent', () => {
    const { tree, chain } = makeStraightTrunk({
      segments: 3,
      length: 0.025,
      radius: 0.015,
      lignification: 0.7,
    });
    const child = chain[1];
    const maxAng = maxJointAngleRad(0.025, 0.015, 0.7);
    setNodeDirConstrained(tree, child, [1, 0, 0]);
    const frames = computeWorldFrames(tree);
    const parentDir = frames.get(chain[0])!.dir;
    const childDir = frames.get(child)!.dir;
    expect(dirAngle(parentDir, childDir)).toBeLessThanOrEqual(maxAng + 1e-5);
  });

  it('spreads residual bend onto primary parent/child for a smoother arc', () => {
    const { tree, chain } = makeStraightTrunk({
      segments: 5,
      length: 0.02,
      radius: 0.012,
      lignification: 0.5,
    });
    const mid = chain[2];
    applyWire(tree, mid);
    // Single aggressive aim — spread should move neighbors off vertical
    bendWiredNode(tree, mid, [1, 0, 0], { spread: 0.7 });

    const frames = computeWorldFrames(tree);
    const parentDefl = dirAngle([0, 1, 0], frames.get(chain[1])!.dir);
    const childDefl = dirAngle([0, 1, 0], frames.get(chain[3])!.dir);
    // With spread > 0, neighbors should take some of the arc
    expect(parentDefl + childDefl).toBeGreaterThan(0.02);
  });

  it('applyWireRun installs wire along primary continuum', () => {
    const { tree, chain } = makeStraightTrunk({
      segments: 5,
      length: 0.02,
      radius: 0.008,
      lignification: 0.3,
    });
    const mid = chain[2];
    const r = applyWireRun(tree, mid, { upHops: 2, downHops: 2 });
    expect(r.ok).toBe(true);
    let wired = 0;
    for (const id of chain) {
      if (tree.nodes[id].wire) wired += 1;
    }
    expect(wired).toBe(5);
    expect(primaryChainIds(tree, mid, 2, 2)).toEqual(chain);
  });

  it('primaryChildId follows near-collinear child', () => {
    const tree = createSapling('juniper-procumbens', 7);
    // Stem is a single chain at build time — root's primary child exists
    const root = tree.nodes[tree.rootId];
    expect(root.children.length).toBeGreaterThan(0);
    const p = primaryChildId(tree, tree.rootId);
    expect(p).toBeTruthy();
    expect(root.children).toContain(p!);
  });

  it('still auto-wires and bumps tension on bend', () => {
    const { tree, chain } = makeStraightTrunk({
      segments: 3,
      length: 0.02,
      radius: 0.006,
      lignification: 0.3,
    });
    const id = chain[1];
    expect(tree.nodes[id].wire).toBeUndefined();
    const r = bendWiredNode(tree, id, [0.2, 0.98, 0]);
    expect(r.ok).toBe(true);
    expect(tree.nodes[id].wire).toBeTruthy();
    expect(tree.nodes[id].wire!.tension).toBeGreaterThan(0.4);
  });
});
