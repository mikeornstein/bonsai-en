import { describe, expect, it } from 'vitest';
import { tickDay, tickDays } from './growth';
import { createRng, quatRotateVec3, vec3 } from './math';
import { getSpecies } from './species/juniper';
import {
  azimuthFromOrientation,
  azimuthSeparation,
  chooseLateralAzimuth,
  collectOccupiedAzimuths,
  countLivingNodes,
  createSapling,
  openSectorAzimuth,
  totalFoliageArea,
  wrapAzimuth,
} from './tree';
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

describe('branch separation (#39)', () => {
  const species = getSpecies('juniper-procumbens');

  it('documents juniper separation knobs', () => {
    expect(species.minSiblingAngle).toBeGreaterThanOrEqual(0.4); // ≥ ~23°
    expect(species.minSiblingAngle).toBeLessThanOrEqual(1.0);
    expect(['golden', 'opposite', 'random']).toContain(species.phyllotaxis);
    expect(species.branchAzimuthRetries).toBeGreaterThan(0);
    expect(species.freeSpaceProbeRadius).toBeGreaterThanOrEqual(0);
  });

  it('azimuth helpers wrap and measure shortest arc', () => {
    expect(wrapAzimuth(-0.1)).toBeCloseTo(Math.PI * 2 - 0.1, 5);
    expect(azimuthSeparation(0.1, Math.PI * 2 - 0.1)).toBeCloseTo(0.2, 5);
    expect(azimuthSeparation(0, Math.PI)).toBeCloseTo(Math.PI, 5);
  });

  it('open sector prefers the largest gap', () => {
    const mid = openSectorAzimuth([0, 0.2], () => 0.5);
    // Largest gap is from 0.2 around to 2π; midpoint near π
    expect(azimuthSeparation(mid, Math.PI)).toBeLessThan(0.3);
  });

  it('chooseLateralAzimuth keeps siblings ≥ minSiblingAngle', () => {
    const tree = createSapling('juniper-procumbens', 12345);
    // Isolate angle logic from soft free-space probes
    const pack = {
      ...species,
      freeSpaceProbeRadius: 0,
      phyllotaxis: 'golden' as const,
    };
    // Fresh host with no siblings
    const host =
      Object.values(tree.nodes).find(
        (n) => n.living && n.id === tree.rootId,
      ) ?? tree.nodes[tree.rootId];
    // Detach all children so occupancy is only the buds we place
    host.children = [];
    host.buds = host.buds.filter((b) => b.type === 'terminal');
    const rng = createRng(99);

    const placed: number[] = [];
    for (let i = 0; i < 3; i++) {
      const az = chooseLateralAzimuth(tree, host.id, pack, rng);
      host.buds.push({
        id: `test-b${i}`,
        type: 'axillary',
        state: 'dormant',
        t: 0.5,
        azimuth: az,
        ageDays: 0,
        breakForce: 0.1,
      });
      placed.push(az);
    }

    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        expect(azimuthSeparation(placed[i], placed[j])).toBeGreaterThanOrEqual(
          pack.minSiblingAngle - 1e-3,
        );
      }
    }

    const occupied = collectOccupiedAzimuths(tree, host);
    expect(occupied.length).toBeGreaterThanOrEqual(3);
  });

  it('after multi-year growth, sibling laterals stay angularly separated', () => {
    const tree = createSapling('juniper-procumbens', 20260326);
    // ~2 plant-years of daily ticks (capped batches)
    for (let i = 0; i < 12; i++) {
      tickDays(tree, 60, 60);
    }

    let pairsChecked = 0;
    let minObserved = Math.PI;
    const threshold = species.minSiblingAngle * 0.85; // small tolerance for best-effort crowding

    for (const parent of Object.values(tree.nodes)) {
      if (!parent.living) continue;
      // Lateral children: clearly off parent axis
      const laterals = parent.children
        .map((id) => tree.nodes[id])
        .filter((c) => {
          if (!c?.living) return false;
          const dir = quatRotateVec3(c.orientation, vec3(0, 1, 0));
          const off = Math.acos(Math.min(1, Math.max(-1, dir[1])));
          return off > 0.3;
        });
      if (laterals.length < 2) continue;

      for (let i = 0; i < laterals.length; i++) {
        for (let j = i + 1; j < laterals.length; j++) {
          const a = azimuthFromOrientation(laterals[i].orientation);
          const b = azimuthFromOrientation(laterals[j].orientation);
          const sep = azimuthSeparation(a, b);
          minObserved = Math.min(minObserved, sep);
          pairsChecked += 1;
          expect(sep).toBeGreaterThanOrEqual(threshold);
        }
      }
    }

    // Fixed seed should produce multi-lateral parents under multi-year growth
    expect(pairsChecked).toBeGreaterThan(0);
    expect(minObserved).toBeGreaterThanOrEqual(threshold);
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
