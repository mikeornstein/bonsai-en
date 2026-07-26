import { describe, expect, it } from 'vitest';
import { tickDay, tickDays } from './growth';
import { createSapling, countLivingNodes, totalFoliageArea } from './tree';
import { pruneAt } from './tools/prune';
import { applyWire, removeWire } from './tools/wire';
import { environmentAt, vitalityWord } from './time';

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

  /**
   * Repro for #32: ~1 plant year of Years-speed growth from a fresh sapling
   * used to land reserves ~3–6 (vitality "Low") in dormant / late rest.
   * Healthy trees keep a winter cushion; HUD never reads as death.
   */
  it('keeps healthy vitality through first winter under year-scale ticks', () => {
    const tree = createSapling('juniper-procumbens', 42);
    expect(tree.agePlantDays).toBe(120);

    // ~1 plant year (issue repro window); also sample each day for dips
    let minReserves = tree.reserves;
    let sawRestSeason = false;
    for (let i = 0; i < 365; i++) {
      tickDay(tree);
      minReserves = Math.min(minReserves, tree.reserves);
      const env = environmentAt(tree.agePlantDays);
      if (env.season === 'dormant' || env.season === 'rest') {
        sawRestSeason = true;
        // Soft floor for healthy vigor — stay out of the Low band
        expect(tree.reserves).toBeGreaterThanOrEqual(6);
        const word = vitalityWord(tree.reserves, env.season);
        expect(word).not.toBe('Low');
      }
    }

    expect(sawRestSeason).toBe(true);
    expect(minReserves).toBeGreaterThanOrEqual(6);
    expect(tree.vigor).toBeGreaterThanOrEqual(0.55);

    // After a full year, still solvent and not labeled Low
    const env = environmentAt(tree.agePlantDays);
    expect(vitalityWord(tree.reserves, env.season)).not.toBe('Low');
    expect(tree.reserves).toBeGreaterThanOrEqual(0);
  });

  it('still allows Low reserves when vigor is stressed', () => {
    const tree = createSapling('juniper-procumbens', 7);
    tree.vigor = 0.25;
    tree.reserves = 2;
    // Force rest season by age (day-of-year ≥ 250 → rest, then dormant)
    tree.agePlantDays = 300;
    for (let i = 0; i < 40; i++) tickDay(tree);
    // Stressed trees are not cushioned — reserves may stay in Low band
    expect(tree.vigor).toBeLessThan(0.55);
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
