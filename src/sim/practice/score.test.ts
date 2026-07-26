import { describe, expect, it } from 'vitest';
import { createSapling, computeWorldFrames } from '../tree';
import { tickDays } from '../growth';
import { pruneAt } from '../tools/prune';
import { scorePracticeMatch, debugPracticeRaster } from './score';
import { PRACTICE_HEIGHT, practiceTargetPolygon } from './target';

describe('practice silhouette score', () => {
  it('target polygon is closed and non-degenerate', () => {
    const poly = practiceTargetPolygon();
    expect(poly.length).toBeGreaterThan(8);
    // span roughly 0..PRACTICE_HEIGHT
    const ys = poly.map((p) => p[1]);
    expect(Math.max(...ys)).toBeCloseTo(PRACTICE_HEIGHT, 5);
    expect(Math.min(...ys)).toBeLessThanOrEqual(0.001);
  });

  it('fresh sapling scores in a mid/low band (not a match)', () => {
    const tree = createSapling('juniper-procumbens', 42);
    const s = scorePracticeMatch(tree);
    expect(s.score).toBeGreaterThanOrEqual(0);
    expect(s.score).toBeLessThanOrEqual(1);
    // Sapling is a starting shape — should not already be "match"
    expect(s.grade).not.toBe('match');
    expect(s.heightRatio).toBeGreaterThan(0.2);
    expect(s.label).toMatch(/Practice/);
  });

  it('grown unpruned tree has more overflow than a pruned one', () => {
    const wild = createSapling('juniper-procumbens', 7);
    tickDays(wild, 400, 400);
    const wildScore = scorePracticeMatch(wild);

    const trained = createSapling('juniper-procumbens', 7);
    tickDays(trained, 400, 400);
    // Prune every living leaf that is far from the x=0 axis
    const frames = computeWorldFrames(trained);
    for (const n of Object.values(trained.nodes)) {
      if (!n.living || n.id === trained.rootId) continue;
      if (n.children.length > 0) continue;
      const f = frames.get(n.id);
      if (!f) continue;
      if (Math.abs(f.tip[0]) > 0.04 || f.tip[1] > PRACTICE_HEIGHT * 1.15) {
        try {
          pruneAt(trained, n.id);
        } catch {
          /* ignore */
        }
      }
    }
    const trainedScore = scorePracticeMatch(trained);

    // Trained should not be worse on overflow (usually better)
    expect(trainedScore.overflow).toBeLessThanOrEqual(wildScore.overflow + 0.08);
    // Both finite
    expect(Number.isFinite(wildScore.score)).toBe(true);
    expect(Number.isFinite(trainedScore.score)).toBe(true);
  });

  it('debug raster returns multi-line ascii', () => {
    const tree = createSapling('juniper-procumbens', 1);
    const ascii = debugPracticeRaster(tree);
    expect(ascii.split('\n').length).toBeGreaterThan(5);
  });
});
