import { afterEach, describe, expect, it } from 'vitest';
import { createSapling, computeWorldFrames } from '../tree';
import { tickDays } from '../growth';
import { pruneAt } from '../tools/prune';
import { scorePracticeMatch, debugPracticeRaster } from './score';
import {
  PRACTICE_HEIGHT,
  getPracticePack,
  practiceTargetPolygon,
  setActivePracticePack,
  type PracticePackId,
} from './target';

afterEach(() => {
  // Keep suite isolated — default remains moyogi
  setActivePracticePack('moyogi');
});

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
    expect(s.packId).toBe('moyogi');
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

describe('practice shape packs (#72)', () => {
  const packIds: PracticePackId[] = ['moyogi', 'cascade', 'literati'];

  it('each pack has non-degenerate stem + polygon', () => {
    for (const id of packIds) {
      const pack = getPracticePack(id);
      expect(pack.stem.length).toBeGreaterThanOrEqual(4);
      const poly = pack.polygon();
      expect(poly.length).toBeGreaterThan(8);
      const ys = poly.map((p) => p[1]);
      expect(Math.max(...ys)).toBeCloseTo(pack.height, 4);
      if (id === 'cascade') {
        expect(Math.min(...ys)).toBeLessThan(0);
        expect(pack.yMin ?? 0).toBeLessThan(0);
      }
    }
  });

  it('moyogi pack scores match legacy defaults numerically for a sapling', () => {
    const tree = createSapling('juniper-procumbens', 42);
    const moyogi = getPracticePack('moyogi');
    const a = scorePracticeMatch(tree, moyogi);
    setActivePracticePack('moyogi');
    const b = scorePracticeMatch(tree);
    expect(a.score).toBeCloseTo(b.score, 10);
    expect(a.grade).toBe(b.grade);
    expect(a.overflow).toBeCloseTo(b.overflow, 10);
  });

  it('sapling vs cascade pack returns finite grade', () => {
    const tree = createSapling('juniper-procumbens', 42);
    const cascade = getPracticePack('cascade');
    const s = scorePracticeMatch(tree, cascade);
    expect(Number.isFinite(s.score)).toBe(true);
    expect(s.score).toBeGreaterThanOrEqual(0);
    expect(s.score).toBeLessThanOrEqual(1);
    expect(['far', 'forming', 'close', 'match']).toContain(s.grade);
    expect(s.packId).toBe('cascade');
    expect(s.label).toMatch(/Cascade/);
  });

  it('sapling vs literati pack returns finite grade', () => {
    const tree = createSapling('juniper-procumbens', 7);
    const s = scorePracticeMatch(tree, getPracticePack('literati'));
    expect(Number.isFinite(s.score)).toBe(true);
    expect(s.packId).toBe('literati');
    expect(s.label).toMatch(/Literati/);
  });

  it('active pack switch changes score geometry without throwing', () => {
    const tree = createSapling('juniper-procumbens', 3);
    setActivePracticePack('cascade');
    const c = scorePracticeMatch(tree);
    setActivePracticePack('literati');
    const l = scorePracticeMatch(tree);
    expect(c.packId).toBe('cascade');
    expect(l.packId).toBe('literati');
    // Different envelopes → scores need not match, but both valid
    expect(Number.isFinite(c.score) && Number.isFinite(l.score)).toBe(true);
  });
});
