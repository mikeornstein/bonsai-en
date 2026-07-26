import { describe, expect, it } from 'vitest';
import { formatAge } from './time';
import {
  createEmptyTree,
  createSapling,
  ensurePlayableTree,
  isPlayableTree,
} from './tree';
import type { TreeState } from './types';

/**
 * Regression: boot used to leave the app on HTML defaults
 * (Age "0 d", Season "—", Nodes "—") when tree state was invalid
 * or Game never finished constructing. These guards must hold.
 */
describe('isPlayableTree / ensurePlayableTree (boot guard)', () => {
  it('rejects null and empty shells that look like HTML-default boot', () => {
    expect(isPlayableTree(null)).toBe(false);
    expect(isPlayableTree(undefined)).toBe(false);
    expect(isPlayableTree(createEmptyTree('juniper-procumbens', 1))).toBe(
      false,
    );
  });

  it('rejects missing root, dead root, and zero-length root', () => {
    const sapling = createSapling('juniper-procumbens', 2);
    const missingRoot: TreeState = {
      ...sapling,
      rootId: 'n-missing',
    };
    expect(isPlayableTree(missingRoot)).toBe(false);

    const deadRoot: TreeState = structuredClone(sapling);
    deadRoot.nodes[deadRoot.rootId].living = false;
    expect(isPlayableTree(deadRoot)).toBe(false);

    const zeroLen: TreeState = structuredClone(sapling);
    zeroLen.nodes[zeroLen.rootId].length = 0;
    expect(isPlayableTree(zeroLen)).toBe(false);

    const badAge: TreeState = structuredClone(sapling);
    badAge.agePlantDays = Number.NaN;
    expect(isPlayableTree(badAge)).toBe(false);
  });

  it('accepts createSapling and requires positive age for a fresh game', () => {
    const tree = createSapling('juniper-procumbens', 42);
    expect(isPlayableTree(tree)).toBe(true);
    // Fresh sapling must not present as the HTML default "0 d"
    expect(tree.agePlantDays).toBeGreaterThan(0);
    expect(formatAge(tree.agePlantDays)).not.toBe('0 d');
    expect(Object.keys(tree.nodes).length).toBeGreaterThan(1);
  });

  it('ensurePlayableTree recovers empty / corrupt saves to a playable sapling', () => {
    const empty = createEmptyTree('juniper-procumbens', 9);
    const recovered = ensurePlayableTree(empty);
    expect(recovered.recovered).toBe(true);
    expect(isPlayableTree(recovered.tree)).toBe(true);
    expect(recovered.tree.agePlantDays).toBeGreaterThan(0);
    expect(formatAge(recovered.tree.agePlantDays)).not.toBe('0 d');

    const ok = createSapling('juniper-procumbens', 11);
    const kept = ensurePlayableTree(ok);
    expect(kept.recovered).toBe(false);
    expect(kept.tree).toBe(ok);
  });

  it('HUD-facing fields for a playable sapling are never HTML placeholders', () => {
    const tree = createSapling('juniper-procumbens', 5);
    // Mirrors what refreshHud writes — these must not match index.html defaults
    const ageText = formatAge(tree.agePlantDays);
    const nodeCount = String(Object.keys(tree.nodes).length);
    expect(ageText).not.toBe('0 d');
    expect(ageText).not.toBe('—');
    expect(ageText.length).toBeGreaterThan(0);
    expect(nodeCount).not.toBe('—');
    expect(Number(nodeCount)).toBeGreaterThan(0);
    expect(tree.speciesId).toBeTruthy();
  });
});
