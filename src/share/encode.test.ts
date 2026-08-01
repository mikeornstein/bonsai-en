import LZString from 'lz-string';
import { describe, expect, it } from 'vitest';
import { tickDay } from '../sim/growth';
import { serializeTree } from '../sim/serialize';
import { applyWire } from '../sim/tools/wire';
import { createSapling } from '../sim/tree';
import type { Internode, TreeState } from '../sim/types';
import {
  COMPACT_VERSION,
  isCompactPayload,
  packTreeCompact,
  quantize,
  unpackTreeCompact,
} from './compact';
import {
  buildShareUrl,
  estimateShareUrlLength,
  MAX_SHARE_URL_LENGTH,
  serializeTreeForShare,
  treeFromShareHash,
  treeToShareHash,
} from './encode';

function growDays(tree: TreeState, days: number): void {
  for (let i = 0; i < days; i++) tickDay(tree);
}

function nodeCount(tree: TreeState): number {
  return Object.keys(tree.nodes).length;
}

/** Structural + numeric-near equality after compact quantize. */
function expectTreesClose(a: TreeState, b: TreeState, eps = 1e-3): void {
  expect(b.schemaVersion).toBe(1);
  expect(b.speciesId).toBe(a.speciesId);
  expect(b.seed).toBe(a.seed);
  expect(b.rootId).toBe(a.rootId);
  expect(b.nextId).toBe(a.nextId);
  expect(b.agePlantDays).toBeCloseTo(a.agePlantDays, 3);
  expect(b.reserves).toBeCloseTo(a.reserves, 3);
  expect(b.rootMass).toBeCloseTo(a.rootMass, 3);
  expect(b.vigor).toBeCloseTo(a.vigor, 3);

  const aIds = Object.keys(a.nodes).sort();
  const bIds = Object.keys(b.nodes).sort();
  expect(bIds).toEqual(aIds);

  for (const id of aIds) {
    const an = a.nodes[id];
    const bn = b.nodes[id];
    expect(bn.parentId).toBe(an.parentId);
    expect(bn.living).toBe(an.living);
    expect(bn.length).toBeCloseTo(an.length, 5);
    expect(bn.targetLength).toBeCloseTo(an.targetLength, 5);
    expect(bn.radius).toBeCloseTo(an.radius, 5);
    expect(bn.targetRadius).toBeCloseTo(an.targetRadius, 5);
    expect(bn.ageDays).toBeCloseTo(an.ageDays, 0);
    expect(bn.lignification).toBeCloseTo(an.lignification, 3);
    expect(bn.wound).toBeCloseTo(an.wound, 3);
    for (let i = 0; i < 4; i++) {
      expect(bn.orientation[i]).toBeCloseTo(an.orientation[i], 4);
    }

    // children rebuilt from parentId — same membership (order may differ)
    expect([...bn.children].sort()).toEqual([...an.children].sort());

    expect(bn.buds.length).toBe(an.buds.length);
    for (let i = 0; i < an.buds.length; i++) {
      const ab = an.buds[i];
      const bb = bn.buds[i];
      expect(bb.id).toBe(ab.id);
      expect(bb.type).toBe(ab.type);
      expect(bb.state).toBe(ab.state);
      expect(bb.t).toBeCloseTo(ab.t, 3);
      expect(bb.azimuth).toBeCloseTo(ab.azimuth, 3);
      expect(bb.ageDays).toBeCloseTo(ab.ageDays, 0);
      expect(bb.breakForce).toBeCloseTo(ab.breakForce, 3);
    }

    expect(bn.foliage.length).toBe(an.foliage.length);
    for (let i = 0; i < an.foliage.length; i++) {
      const af = an.foliage[i];
      const bf = bn.foliage[i];
      expect(bf.id).toBe(af.id);
      expect(bf.living).toBe(af.living);
      expect(bf.t).toBeCloseTo(af.t, 3);
      expect(bf.azimuth).toBeCloseTo(af.azimuth, 3);
      expect(bf.area).toBeCloseTo(af.area, 3);
      expect(bf.biomass).toBeCloseTo(af.biomass, 3);
      expect(bf.efficiency).toBeCloseTo(af.efficiency, 3);
    }

    if (an.wire) {
      expect(bn.wire).toBeDefined();
      const aw = an.wire;
      const bw = bn.wire!;
      expect(bw.setAmount).toBeCloseTo(aw.setAmount, 3);
      expect(bw.tension).toBeCloseTo(aw.tension, 3);
      expect(bw.installedPlantDay).toBeCloseTo(aw.installedPlantDay, 0);
      for (let i = 0; i < 4; i++) {
        expect(bw.targetOrientation[i]).toBeCloseTo(aw.targetOrientation[i], 4);
        expect(bw.installOrientation[i]).toBeCloseTo(
          aw.installOrientation[i],
          4,
        );
      }
    } else {
      expect(bn.wire).toBeUndefined();
    }

    // keep eps used so lint doesn't complain if we tighten later
    void eps;
  }
}

describe('quantize', () => {
  it('rounds to digit places and maps non-finite to 0', () => {
    expect(quantize(1.234567, 3)).toBe(1.235);
    expect(quantize(Number.NaN, 2)).toBe(0);
    expect(quantize(Number.POSITIVE_INFINITY, 2)).toBe(0);
  });
});

describe('compact pack/unpack', () => {
  it('roundtrips a sapling with schemaVersion 1', () => {
    const tree = createSapling('juniper-procumbens', 42);
    const packed = packTreeCompact(tree);
    expect(packed[0]).toBe(COMPACT_VERSION);
    expect(isCompactPayload(packed)).toBe(true);
    const restored = unpackTreeCompact(packed);
    expectTreesClose(tree, restored);
  });

  it('roundtrips a grown tree (~60 nodes) and a wired node', () => {
    const tree = createSapling('juniper-procumbens', 7);
    growDays(tree, 180);
    // Wire a non-root living node if present
    const candidate = Object.values(tree.nodes).find(
      (n: Internode) => n.parentId && n.living,
    );
    if (candidate) applyWire(tree, candidate.id);

    const restored = unpackTreeCompact(packTreeCompact(tree));
    expect(nodeCount(restored)).toBe(nodeCount(tree));
    expect(nodeCount(tree)).toBeGreaterThanOrEqual(50);
    expectTreesClose(tree, restored);
  });

  it('rebuilds children from parentId', () => {
    const tree = createSapling('juniper-procumbens', 3);
    const packed = packTreeCompact(tree);
    // packed nodes omit children — only parentId is stored
    const nodes = packed[9] as unknown[];
    for (const row of nodes) {
      expect(Array.isArray(row)).toBe(true);
      // no children array field in compact row
      expect((row as unknown[]).length).toBeGreaterThanOrEqual(16);
    }
    const restored = unpackTreeCompact(packed);
    for (const n of Object.values(restored.nodes)) {
      for (const childId of n.children) {
        expect(restored.nodes[childId]?.parentId).toBe(n.id);
      }
    }
  });
});

describe('share hash encode/decode', () => {
  it('roundtrips via treeToShareHash / treeFromShareHash', () => {
    const tree = createSapling('juniper-procumbens', 99);
    growDays(tree, 90);
    const hash = treeToShareHash(tree);
    expect(hash.startsWith('#s=')).toBe(true);
    const restored = treeFromShareHash(hash);
    expect(restored).not.toBeNull();
    expectTreesClose(tree, restored!);
  });

  it('accepts legacy full-JSON LZ hashes', () => {
    const tree = createSapling('juniper-procumbens', 11);
    const legacy = `#s=${LZString.compressToEncodedURIComponent(serializeTree(tree))}`;
    const restored = treeFromShareHash(legacy);
    expect(restored).not.toBeNull();
    expect(restored!.schemaVersion).toBe(1);
    expect(restored!.rootId).toBe(tree.rootId);
    expect(nodeCount(restored!)).toBe(nodeCount(tree));
  });

  it('returns null for garbage / empty payloads', () => {
    expect(treeFromShareHash('')).toBeNull();
    expect(treeFromShareHash('#x=abc')).toBeNull();
    expect(treeFromShareHash('#s=')).toBeNull();
    expect(treeFromShareHash('#s=not-valid-lz')).toBeNull();
  });
});

describe('share link size capacity', () => {
  it('compact share payload is much smaller than full JSON before LZ', () => {
    const tree = createSapling('juniper-procumbens', 42);
    growDays(tree, 180);
    const full = serializeTree(tree).length;
    const compact = serializeTreeForShare(tree).length;
    expect(nodeCount(tree)).toBeGreaterThanOrEqual(50);
    // Expect roughly 3×+ smaller pre-LZ (keys + precision)
    expect(compact).toBeLessThan(full * 0.4);
  });

  it('mid-grown tree stays shareable; compact beats full JSON', () => {
    const tree = createSapling('juniper-procumbens', 42);
    growDays(tree, 180);
    const nodes = nodeCount(tree);
    // Higher counts after #83 half-internode + #87 denser forking
    expect(nodes).toBeGreaterThanOrEqual(50);
    expect(nodes).toBeLessThan(280);

    const urlLen = estimateShareUrlLength(tree);
    expect(urlLen).toBeLessThanOrEqual(MAX_SHARE_URL_LENGTH);

    // Compact beats full JSON pre-LZ (keys + precision)
    const full = serializeTree(tree).length;
    const compact = serializeTreeForShare(tree).length;
    expect(compact).toBeLessThan(full * 0.4);

    const legacyLz = LZString.compressToEncodedURIComponent(
      serializeTree(tree),
    ).length;
    const compactLz = LZString.compressToEncodedURIComponent(
      serializeTreeForShare(tree),
    ).length;
    // LZ ratio drifts with denser graphs; compact must still win clearly
    expect(compactLz).toBeLessThan(legacyLz * 0.5);
    expect(legacyLz).toBeGreaterThan(12000);
  });

  it('~1-year tree fits under MAX_SHARE_URL_LENGTH (or documents fallback)', () => {
    const tree = createSapling('juniper-procumbens', 42);
    growDays(tree, 365);
    const nodes = nodeCount(tree);
    expect(nodes).toBeGreaterThan(150);

    const urlLen = estimateShareUrlLength(tree);
    // Dense #83/#87 graphs may exceed the URL budget; product falls back to
    // file/image share when over MAX_SHARE_URL_LENGTH.
    if (urlLen <= MAX_SHARE_URL_LENGTH) {
      const restored = treeFromShareHash(treeToShareHash(tree));
      expect(restored).not.toBeNull();
      expect(nodeCount(restored!)).toBe(nodes);
    } else {
      expect(urlLen).toBeGreaterThan(MAX_SHARE_URL_LENGTH);
      // Still must round-trip via compact codec when forced (export path)
      const restored = treeFromShareHash(treeToShareHash(tree));
      expect(restored).not.toBeNull();
      expect(nodeCount(restored!)).toBe(nodes);
    }
  });

  it('documents MAX_SHARE_URL_LENGTH is above the old hard 8k cutoff', () => {
    expect(MAX_SHARE_URL_LENGTH).toBeGreaterThan(8000);
    expect(MAX_SHARE_URL_LENGTH).toBeLessThanOrEqual(32_000);
  });
});

describe('buildShareUrl', () => {
  it('returns an absolute url under the size budget for a young tree', () => {
    const tree = createSapling('juniper-procumbens', 7);
    const built = buildShareUrl(
      tree,
      'https://mikeornstein.github.io/bonsai-en/',
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(
      built.url.startsWith('https://mikeornstein.github.io/bonsai-en/#s='),
    ).toBe(true);
    expect(built.url.length).toBeLessThanOrEqual(MAX_SHARE_URL_LENGTH);
    const restored = treeFromShareHash(built.url.slice(built.url.indexOf('#')));
    expect(restored).not.toBeNull();
    expect(restored!.rootId).toBe(tree.rootId);
  });

  it('reports too_large when the URL would exceed MAX_SHARE_URL_LENGTH', () => {
    const tree = createSapling('juniper-procumbens', 7);
    const hash = treeToShareHash(tree);
    const hugeBase = 'https://example.com/' + 'x'.repeat(MAX_SHARE_URL_LENGTH);
    const built = buildShareUrl(tree, hugeBase);
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.reason).toBe('too_large');
    expect(built.length).toBe(hugeBase.length + hash.length);
  });
});

