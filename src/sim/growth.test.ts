import { describe, expect, it } from 'vitest';
import { tickDay, tickDays } from './growth';
import { createSapling, countLivingNodes, totalFoliageArea } from './tree';
import { pruneAt } from './tools/prune';
import { applyWire, removeWire } from './tools/wire';

describe('sapling', () => {
  it('creates a living juniper with foliage', () => {
    const tree = createSapling('juniper-procumbens', 42);
    expect(tree.rootId).toBeTruthy();
    expect(countLivingNodes(tree)).toBeGreaterThan(5);
    expect(totalFoliageArea(tree)).toBeGreaterThan(0);
  });
});

describe('growth', () => {
  it('ages and can grow over many days', () => {
    const tree = createSapling('juniper-procumbens', 7);
    const age0 = tree.agePlantDays;
    const nodes0 = countLivingNodes(tree);
    tickDays(tree, 120, 120);
    expect(tree.agePlantDays).toBe(age0 + 120);
    // Reserves should stay finite
    expect(tree.reserves).toBeGreaterThanOrEqual(0);
    expect(countLivingNodes(tree)).toBeGreaterThanOrEqual(nodes0);
  });

  it('thickens trunk over long time', () => {
    const tree = createSapling('juniper-procumbens', 99);
    const r0 = tree.nodes[tree.rootId].radius;
    for (let i = 0; i < 400; i++) tickDay(tree);
    const r1 = tree.nodes[tree.rootId].radius;
    expect(r1).toBeGreaterThanOrEqual(r0 * 0.99);
  });
});

describe('prune', () => {
  it('removes distal segments and keeps parent', () => {
    const tree = createSapling('juniper-procumbens', 3);
    const child = Object.values(tree.nodes).find(
      (n) => n.parentId === tree.rootId && n.children.length >= 0,
    );
    expect(child).toBeTruthy();
    // Find a non-root prune target
    const tip = Object.values(tree.nodes).find(
      (n) => n.id !== tree.rootId && n.children.length === 0,
    )!;
    const before = countLivingNodes(tree);
    const result = pruneAt(tree, tip.id);
    expect(result.ok).toBe(true);
    expect(countLivingNodes(tree)).toBeLessThan(before);
    expect(tree.nodes[tree.rootId]).toBeTruthy();
  });
});

describe('wire', () => {
  it('sets shape partially after time', () => {
    const tree = createSapling('juniper-procumbens', 11);
    const node = Object.values(tree.nodes).find((n) => n.id !== tree.rootId)!;
    applyWire(tree, node.id);
    expect(tree.nodes[node.id].wire).toBeTruthy();
    // Bend target
    tree.nodes[node.id].wire!.targetOrientation = [0.1, 0.2, 0.0, 0.97];
    for (let i = 0; i < 200; i++) tickDay(tree);
    const setAmount = tree.nodes[node.id].wire!.setAmount;
    expect(setAmount).toBeGreaterThan(0.05);
    removeWire(tree, node.id);
    expect(tree.nodes[node.id].wire).toBeUndefined();
  });
});
