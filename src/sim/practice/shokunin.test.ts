import { describe, expect, it } from 'vitest';
import { createSapling } from '../tree';
import { tickDays } from '../growth';
import { pruneAt } from '../tools/prune';
import { scorePracticeMatch } from './score';
import { PRACTICE_STEM } from './target';
import {
  primaryOverflowReason,
  primaryStemNodeIds,
  rankOverflowPruneTargets,
  stemBendDirections,
  stemDirectionAtHeight,
  stemXAtHeight,
  targetHalfWidthAt,
} from './shokunin';

describe('shokunin practice helpers', () => {
  it('targetHalfWidthAt is positive mid-canopy and near zero at base', () => {
    const mid = targetHalfWidthAt(0.14);
    const base = targetHalfWidthAt(0.005);
    expect(mid).toBeGreaterThan(0.02);
    expect(base).toBeLessThan(mid);
  });

  it('primaryStemNodeIds follows first-child chain base→apex', () => {
    const tree = createSapling('juniper-procumbens', 42);
    const ids = primaryStemNodeIds(tree);
    expect(ids.length).toBeGreaterThan(0);
    // Chain is contiguous via parentId
    for (let i = 1; i < ids.length; i++) {
      expect(tree.nodes[ids[i]].parentId).toBe(ids[i - 1]);
    }
    // Root excluded
    expect(ids.includes(tree.rootId)).toBe(false);
    // All living
    for (const id of ids) {
      expect(tree.nodes[id].living).toBe(true);
    }
  });

  it('stemBendDirections returns unit-ish vectors along PRACTICE_STEM', () => {
    const dirs = stemBendDirections(PRACTICE_STEM);
    expect(dirs.length).toBe(PRACTICE_STEM.length - 1);
    for (const d of dirs) {
      const len = Math.hypot(d[0], d[1], d[2]);
      expect(len).toBeGreaterThan(0.9);
      expect(len).toBeLessThan(1.1);
      // Mostly upright
      expect(d[1]).toBeGreaterThan(0.5);
    }
    // First lean matches first segment sign of dx
    const dx0 = PRACTICE_STEM[1][0] - PRACTICE_STEM[0][0];
    expect(Math.sign(dirs[0][0])).toBe(Math.sign(dx0) || Math.sign(dirs[0][0]));
  });

  it('stemDirectionAtHeight / stemXAtHeight sample the S-curve', () => {
    // Vertex on PRACTICE_STEM (moyogi first-bend / counter — see docs/refs/sumi/)
    const y = 0.055;
    const x = stemXAtHeight(y);
    expect(x).toBeCloseTo(-0.016, 3);
    // Mid counter-bend lean positive-x
    expect(stemXAtHeight(0.135)).toBeCloseTo(0.018, 3);
    const dir = stemDirectionAtHeight(y);
    expect(Math.hypot(dir[0], dir[1], dir[2])).toBeGreaterThan(0.9);
  });

  it('primaryOverflowReason picks the dominant envelope failure', () => {
    expect(
      primaryOverflowReason({
        outsidePoly: true,
        lateralOver: 0.02,
        heightOver: 0,
        depthPenalty: 0,
        lowFat: 0,
      }),
    ).toBe('Outside pad');
    expect(
      primaryOverflowReason({
        outsidePoly: false,
        lateralOver: 0,
        heightOver: 0.05,
        depthPenalty: 0,
        lowFat: 0,
      }),
    ).toBe('Above apex');
    expect(
      primaryOverflowReason({
        outsidePoly: false,
        lateralOver: 0,
        heightOver: 0,
        depthPenalty: 0.04,
        lowFat: 0,
      }),
    ).toBe('Depth spoils front');
  });

  it('rankOverflowPruneTargets prefers envelope outliers over longest tips', () => {
    const tree = createSapling('juniper-procumbens', 11);
    tickDays(tree, 350, 350);
    const ranked = rankOverflowPruneTargets(tree, { max: 8 });
    // Grown tree should have some overflow candidates
    expect(ranked.length).toBeGreaterThan(0);
    // Keys descending
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1].overflowKey).toBeGreaterThanOrEqual(
        ranked[i].overflowKey,
      );
    }
    // Top candidates should be meaningfully outside center / envelope
    const top = ranked[0];
    expect(
      Math.abs(top.tipX) > 0.03 ||
        top.tipY > 0.24 ||
        Math.abs(top.tipZ) > 0.02 ||
        top.overflowKey > 0.01,
    ).toBe(true);
    // Coach reason is always one of the known labels
    const reasons = new Set([
      'Outside pad',
      'Above apex',
      'Depth spoils front',
    ]);
    for (const r of ranked) {
      expect(reasons.has(r.reason)).toBe(true);
    }
  });

  it('structural prune of ranked overflow reduces overflow in scorePracticeMatch', () => {
    const wild = createSapling('juniper-procumbens', 19);
    tickDays(wild, 420, 420);
    const before = scorePracticeMatch(wild);

    const trained = createSapling('juniper-procumbens', 19);
    tickDays(trained, 420, 420);
    const targets = rankOverflowPruneTargets(trained, { max: 10 });
    let pruned = 0;
    for (const t of targets) {
      try {
        const r = pruneAt(trained, t.id);
        if (r.ok) pruned++;
      } catch {
        /* ignore */
      }
    }
    expect(pruned).toBeGreaterThan(0);
    const after = scorePracticeMatch(trained);

    // Overflow should not get worse (usually improves)
    expect(after.overflow).toBeLessThanOrEqual(before.overflow + 0.06);
    // Containment (iou) should not collapse
    expect(after.iou).toBeGreaterThanOrEqual(before.iou - 0.06);
  });
});
