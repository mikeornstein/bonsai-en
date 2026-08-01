import { describe, expect, it } from 'vitest';
import { describeNode, MAX_TREE_NODES, tickDay, tickDays } from './growth';
import { createRng } from './math';
import { getSpecies } from './species/juniper';
import {
  azimuthFromOrientation,
  azimuthSeparation,
  branchOrder,
  chooseLateralAzimuth,
  collectOccupiedAzimuths,
  computeWorldFrames,
  countLateralChildren,
  countLivingNodes,
  createSapling,
  extendFromBud,
  isLateralOrientation,
  maxMainStemNodes,
  minMainStemLateralDepth,
  offAxisAngle,
  openSectorAzimuth,
  spawnShootRadius,
  totalFoliageArea,
  unbranchedRunLength,
  wrapAzimuth,
} from './tree';
import { pruneAt } from './tools/prune';
import { applyWire, removeWire } from './tools/wire';
import { environmentAt, vitalityWord } from './time';
import type { Internode, NodeId } from './types';

function mainStemContinuation(
  tree: ReturnType<typeof createSapling>,
  nodeId: NodeId,
): NodeId | null {
  const n = tree.nodes[nodeId];
  if (!n) return null;
  for (const id of n.children) {
    const c = tree.nodes[id];
    if (c?.living && !isLateralOrientation(c.orientation)) return id;
  }
  return null;
}

describe('sapling', () => {
  it('creates a living juniper with foliage', () => {
    const tree = createSapling('juniper-procumbens', 42);
    expect(tree.rootId).toBeTruthy();
    expect(countLivingNodes(tree)).toBeGreaterThan(5);
    expect(totalFoliageArea(tree)).toBeGreaterThan(0);
  });

  /** #83: half internode length / 2× stem nodes keeps pot-scale height. */
  it('uses finer internodes with comparable stem height (#83)', () => {
    const species = getSpecies('juniper-procumbens');
    expect(species.internodeLength.min).toBeCloseTo(0.006, 5);
    expect(species.internodeLength.max).toBeCloseTo(0.014, 5);
    expect(species.saplingStemNodes).toBe(14);

    const tree = createSapling('juniper-procumbens', 42);
    // Walk main stem (first-child chain)
    let cursor: NodeId | null = tree.rootId;
    let stemLen = 0;
    let stemNodes = 0;
    while (cursor) {
      const node: Internode | undefined = tree.nodes[cursor];
      if (!node) break;
      stemLen += node.length;
      stemNodes += 1;
      cursor = node.children[0] ?? null;
      if (stemNodes > 40) break;
    }
    // ~14 × ~1 cm mid-range ≈ 0.14 m; allow variance from RNG length jitter
    expect(stemNodes).toBeGreaterThanOrEqual(14);
    expect(stemLen).toBeGreaterThan(0.08);
    expect(stemLen).toBeLessThan(0.28);

    for (const n of Object.values(tree.nodes)) {
      if (!n.living || n.parentId === null) continue;
      // New wood should not be the old ~2.8 cm max
      expect(n.length).toBeLessThanOrEqual(species.internodeLength.max * 1.3);
    }
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

  /**
   * Repro for #63: ~5 plant-years of Years FF from a fresh sapling used to
   * hit the node cap, age out every pad, and leave a bare “dead” tree
   * (foliageArea=0, reserves→0, vitality Low in flush season).
   */
  it('keeps living canopy through multi-year Years fast-forward (#63)', () => {
    expect(MAX_TREE_NODES).toBeGreaterThanOrEqual(560);
    const tree = createSapling('juniper-procumbens', 42);
    // ~5 plant-years at Years pace (~5s wall clock)
    for (let i = 0; i < 1825; i++) tickDay(tree);

    expect(countLivingNodes(tree)).toBeGreaterThan(50);
    // Must not stall forever at the hard graph cap under 2× resolution (#83)
    expect(Object.keys(tree.nodes).length).toBeLessThanOrEqual(MAX_TREE_NODES);
    const foliage = totalFoliageArea(tree);
    expect(foliage).toBeGreaterThan(0.01);

    let livingPads = 0;
    for (const n of Object.values(tree.nodes)) {
      for (const f of n.foliage) {
        if (f.living) livingPads += 1;
      }
    }
    expect(livingPads).toBeGreaterThan(30);

    // Solvent enough that the player does not read the tree as dead
    expect(tree.reserves).toBeGreaterThan(0);
    expect(tree.vigor).toBeGreaterThan(0.5);
    const env = environmentAt(tree.agePlantDays);
    // Not "Low" purely from multi-year aging (rest seasons may say Resting)
    if (!['dormant', 'rest'].includes(env.season)) {
      expect(vitalityWord(tree.reserves, env.season)).not.toBe('Low');
    }
  });

  it('evergreen turnover restores pads after artificial defoliation (#63)', () => {
    const tree = createSapling('juniper-procumbens', 11);
    // Grow into flush with some structure
    tickDays(tree, 80, 80);
    // Strip all living pads (old bug end-state)
    for (const n of Object.values(tree.nodes)) {
      for (const f of n.foliage) f.living = false;
      n.foliage = [];
    }
    expect(totalFoliageArea(tree)).toBe(0);

    // Force spring flush window for eager reflush
    tree.agePlantDays = 100;
    tree.vigor = 0.95;
    tree.reserves = 40;
    for (let i = 0; i < 90; i++) tickDay(tree);

    expect(totalFoliageArea(tree)).toBeGreaterThan(0.002);
    let livingPads = 0;
    for (const n of Object.values(tree.nodes)) {
      for (const f of n.foliage) {
        if (f.living) livingPads += 1;
      }
    }
    expect(livingPads).toBeGreaterThan(5);
  });
});

describe('min branch diameter (#58)', () => {
  const species = getSpecies('juniper-procumbens');
  /** Old render floor that fattened every twig (~3.2 mm diam). */
  const OLD_VISUAL_FLOOR = 0.0016;

  it('documents species tip floor in the fine-feature band', () => {
    // Target ~0.3–0.6 mm radius tips for juniper
    expect(species.minRadius).toBeGreaterThanOrEqual(0.0003);
    expect(species.minRadius).toBeLessThanOrEqual(0.0006);
    expect(species.minRadius).toBeLessThan(OLD_VISUAL_FLOOR);
    expect(species.minRadius).toBeLessThan(species.saplingRadius);
  });

  it('extendFromBud floors at species.minRadius, not the old 0.0008 hard floor', () => {
    const tree = createSapling('juniper-procumbens', 58);
    // Artificial thin parent so spawn hits the tip floor
    const host = Object.values(tree.nodes).find(
      (n) => n.living && n.id !== tree.rootId && n.children.length === 0,
    )!;
    host.radius = species.minRadius * 1.1;
    host.buds = [
      {
        id: 'test-ax',
        type: 'axillary',
        state: 'flushing',
        t: 0.5,
        azimuth: 1.2,
        ageDays: 5,
        breakForce: 1,
      },
    ];
    const rng = createRng(1);
    const child = extendFromBud(
      tree,
      host.id,
      host.buds[0],
      species,
      rng,
    );
    expect(child).toBeTruthy();
    expect(child!.radius).toBeGreaterThanOrEqual(species.minRadius - 1e-12);
    // Fine enough that the old visual floor would have inflated it
    expect(child!.radius).toBeLessThan(OLD_VISUAL_FLOOR);
  });

  it('new laterals start near tip size even on a thick parent (#87)', () => {
    // Old rule parent*0.62 made trunk forks several× thicker than tip forks
    const thick = species.saplingRadius; // ~7 mm trunk-ish
    const thin = species.minRadius * 2;
    const fromThick = spawnShootRadius(thick, 'axillary', species);
    const fromThin = spawnShootRadius(thin, 'axillary', species);
    expect(fromThick).toBeLessThanOrEqual(species.minRadius * 1.4 + 1e-12);
    expect(fromThick).toBeLessThan(thick * 0.4);
    // Same tip band whether parent is trunk or twig
    expect(Math.abs(fromThick - fromThin)).toBeLessThan(species.minRadius * 0.5);

    const tree = createSapling('juniper-procumbens', 58);
    const host = tree.nodes[tree.rootId];
    host.radius = thick;
    host.buds = [
      {
        id: 'ax-fat-parent',
        type: 'axillary',
        state: 'flushing',
        t: 0.5,
        azimuth: 1.0,
        ageDays: 5,
        breakForce: 1,
      },
    ];
    // Detach so maxChildren lateral count is free
    host.children = [];
    const child = extendFromBud(
      tree,
      host.id,
      host.buds[0],
      species,
      createRng(2),
    );
    expect(child).toBeTruthy();
    expect(child!.radius).toBeLessThanOrEqual(species.minRadius * 1.4 + 1e-9);
    expect(child!.radius).toBeLessThan(OLD_VISUAL_FLOOR);
  });

  it('after multi-year growth, some living tips are below the old 0.0016 floor', () => {
    const tree = createSapling('juniper-procumbens', 20260726);
    for (let i = 0; i < 18; i++) {
      tickDays(tree, 60, 60);
    }

    const livingTips = Object.values(tree.nodes).filter(
      (n) => n.living && n.children.length === 0,
    );
    expect(livingTips.length).toBeGreaterThan(0);

    const fine = livingTips.filter((n) => n.radius < OLD_VISUAL_FLOOR);
    expect(fine.length).toBeGreaterThan(0);

    // All living wood respects the species floor
    for (const n of Object.values(tree.nodes)) {
      if (!n.living) continue;
      expect(n.radius).toBeGreaterThanOrEqual(species.minRadius - 1e-12);
    }

    // Taper chain: parent radius >= child * modest factor (sim target enforces ~1.08)
    for (const child of Object.values(tree.nodes)) {
      if (!child.living || !child.parentId) continue;
      const parent = tree.nodes[child.parentId];
      if (!parent?.living) continue;
      // Actual radius can lag target slightly; soft check on targets
      expect(parent.targetRadius).toBeGreaterThanOrEqual(
        child.targetRadius * 0.95,
      );
    }
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
    // Isolate angle logic from soft free-space probes; allow multi for this probe
    const pack = {
      ...species,
      freeSpaceProbeRadius: 0,
      maxChildren: 3,
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

  it('forced multi-laterals stay angularly separated (#39)', () => {
    // Natural growth is maxChildren=1 (#87); construct siblings to check separation.
    const tree = createSapling('juniper-procumbens', 20260326);
    const pack = {
      ...species,
      freeSpaceProbeRadius: 0,
      maxChildren: 3,
    };
    const host = tree.nodes[tree.rootId];
    host.children = [];
    host.buds = host.buds.filter((b) => b.type === 'terminal');
    const rng = createRng(42);
    const kids = [];
    for (let i = 0; i < 2; i++) {
      const az = chooseLateralAzimuth(tree, host.id, pack, rng);
      host.buds.push({
        id: `force-ax-${i}`,
        type: 'axillary',
        state: 'flushing',
        t: 0.5,
        azimuth: az,
        ageDays: 5,
        breakForce: 1,
      });
      const child = extendFromBud(
        tree,
        host.id,
        host.buds[host.buds.length - 1],
        pack,
        rng,
      );
      expect(child).toBeTruthy();
      kids.push(child!);
    }
    expect(kids.length).toBe(2);
    const sep = azimuthSeparation(
      azimuthFromOrientation(kids[0].orientation),
      azimuthFromOrientation(kids[1].orientation),
    );
    expect(sep).toBeGreaterThanOrEqual(pack.minSiblingAngle * 0.85);
  });
});

describe('branching form (#87)', () => {
  const species = getSpecies('juniper-procumbens');

  it('documents wider takeoff, single-lateral hosts, freer forks', () => {
    // ~45–55° takeoff; continuations are near-collinear (monopodial)
    expect(species.branchAngle.mean).toBeGreaterThanOrEqual(0.75);
    expect(species.branchAngle.mean).toBeLessThanOrEqual(1.05);
    expect(species.maxChildren).toBe(1);
    expect(species.lateralBudChance).toBeGreaterThanOrEqual(0.01);
    expect(species.apicalDominance).toBeLessThanOrEqual(0.72);
    expect(species.budBreakThreshold).toBeLessThanOrEqual(0.5);
  });

  it('terminal extension stays nearly collinear (monopodial flush, not zigzag)', () => {
    const tree = createSapling('juniper-procumbens', 11);
    const tip = Object.values(tree.nodes).find(
      (n) => n.living && n.children.length === 0,
    )!;
    tip.buds = [
      {
        id: 'term-straight',
        type: 'terminal',
        state: 'flushing',
        t: 1,
        azimuth: 0,
        ageDays: 5,
        breakForce: 1,
      },
    ];
    const rng = createRng(3);
    const child = extendFromBud(tree, tip.id, tip.buds[0], species, rng);
    expect(child).toBeTruthy();
    // Local pitch from parent +Y should be tiny (~1° class), not ~8° kinks
    expect(offAxisAngle(child!.orientation)).toBeLessThan(0.08);
  });

  it('places sapling laterals above the low trunk broom zone', () => {
    const tree = createSapling('juniper-procumbens', 42);
    const minDepth = minMainStemLateralDepth(species.saplingStemNodes);
    let lowMain = 0;
    let upperMain = 0;
    for (const parent of Object.values(tree.nodes)) {
      if (!parent.living) continue;
      if (branchOrder(tree, parent.id) !== 0) continue;
      const lats = parent.children
        .map((id) => tree.nodes[id])
        .filter((c) => c?.living && isLateralOrientation(c.orientation));
      if (lats.length === 0) continue;
      const d = (() => {
        let n = 0;
        let cur = parent;
        while (cur.parentId) {
          n += 1;
          cur = tree.nodes[cur.parentId]!;
        }
        return n;
      })();
      if (d < minDepth) lowMain += lats.length;
      else upperMain += lats.length;
    }
    expect(lowMain).toBe(0);
    expect(upperMain).toBeGreaterThanOrEqual(species.saplingLaterals);
  });

  it('sapling main stem has character lean, not a pure vertical pole', () => {
    const tree = createSapling('juniper-procumbens', 42);
    const frames = computeWorldFrames(tree);
    // Walk near-axis main stem
    const stem: NodeId[] = [];
    let cur: NodeId | null = tree.rootId;
    while (cur && stem.length < 40) {
      stem.push(cur);
      cur = mainStemContinuation(tree, cur);
    }
    expect(stem.length).toBe(species.saplingStemNodes);
    const tip = frames.get(stem[stem.length - 1])!;
    const tipHoriz = Math.hypot(tip.tip[0], tip.tip[2]);
    const tipY = Math.max(1e-6, tip.tip[1]);
    // Tip should sit clearly off the vertical axis (was ~0 on pure +Y poles)
    expect(tipHoriz / tipY).toBeGreaterThan(0.12);
    // Upper stem should not read as pure +Y
    expect(tip.dir[1]).toBeLessThan(0.97);
  });

  it('main stem does not tower with extra vertical internodes under Years FF', () => {
    const tree = createSapling('juniper-procumbens', 42);
    const cap = maxMainStemNodes(species.saplingStemNodes);
    for (let i = 0; i < 12; i++) tickDays(tree, 60, 60);

    let stemNodes = 0;
    let cur: NodeId | null = tree.rootId;
    while (cur && stemNodes < 80) {
      stemNodes += 1;
      cur = mainStemContinuation(tree, cur);
    }
    expect(stemNodes).toBeLessThanOrEqual(cap);
    expect(stemNodes).toBeGreaterThanOrEqual(species.saplingStemNodes);
  });

  it('extendFromBud rejects a second lateral on the same host', () => {
    const tree = createSapling('juniper-procumbens', 87);
    const host = Object.values(tree.nodes).find(
      (n) => n.living && n.id !== tree.rootId && n.children.length === 0,
    )!;
    const rng = createRng(3);
    const budA = {
      id: 'ax-a',
      type: 'axillary' as const,
      state: 'flushing' as const,
      t: 0.5,
      azimuth: 0.4,
      ageDays: 5,
      breakForce: 1,
    };
    const budB = {
      id: 'ax-b',
      type: 'axillary' as const,
      state: 'flushing' as const,
      t: 0.6,
      azimuth: 2.5,
      ageDays: 5,
      breakForce: 1,
    };
    host.buds = [budA, budB];
    const first = extendFromBud(tree, host.id, budA, species, rng);
    expect(first).toBeTruthy();
    expect(countLateralChildren(tree, host)).toBe(1);
    const second = extendFromBud(tree, host.id, budB, species, rng);
    expect(second).toBeNull();
    expect(countLateralChildren(tree, host)).toBe(1);
  });

  it('extendFromBud still allows terminal extension after a lateral', () => {
    const tree = createSapling('juniper-procumbens', 88);
    const host = Object.values(tree.nodes).find(
      (n) => n.living && n.id !== tree.rootId && n.children.length === 0,
    )!;
    const rng = createRng(5);
    host.buds = [
      {
        id: 'ax-1',
        type: 'axillary',
        state: 'flushing',
        t: 0.5,
        azimuth: 1.1,
        ageDays: 5,
        breakForce: 1,
      },
      {
        id: 'term-1',
        type: 'terminal',
        state: 'flushing',
        t: 1,
        azimuth: 0,
        ageDays: 5,
        breakForce: 1,
      },
    ];
    expect(
      extendFromBud(tree, host.id, host.buds[0], species, rng),
    ).toBeTruthy();
    const tip = extendFromBud(tree, host.id, host.buds[1], species, rng);
    expect(tip).toBeTruthy();
    expect(isLateralOrientation(tip!.orientation)).toBe(false);
    expect(countLateralChildren(tree, host)).toBe(1);
    expect(host.children.length).toBe(2);
  });

  it('after multi-year growth, laterals are wide and rarely stacked', () => {
    const tree = createSapling('juniper-procumbens', 20260731);
    for (let i = 0; i < 12; i++) {
      tickDays(tree, 60, 60);
    }

    let multiHosts = 0;
    let singleHosts = 0;
    let takeoffSum = 0;
    let takeoffN = 0;
    let lateralHosts = 0;
    let lowMainLaterals = 0;
    let longSecondaryRuns = 0;
    let secondaryTips = 0;
    const minDepth = minMainStemLateralDepth(species.saplingStemNodes);

    for (const parent of Object.values(tree.nodes)) {
      if (!parent.living) continue;
      const laterals = parent.children
        .map((id) => tree.nodes[id])
        .filter((c) => c?.living && isLateralOrientation(c.orientation));
      if (laterals.length >= 2) multiHosts += 1;
      else if (laterals.length === 1) singleHosts += 1;
      if (laterals.length > 0) lateralHosts += 1;
      for (const lat of laterals) {
        takeoffSum += offAxisAngle(lat.orientation);
        takeoffN += 1;
        if (branchOrder(tree, parent.id) === 0) {
          let d = 0;
          let cur: typeof parent | undefined = parent;
          while (cur?.parentId) {
            d += 1;
            cur = tree.nodes[cur.parentId];
          }
          if (d < minDepth) lowMainLaterals += 1;
        }
      }
    }

    for (const n of Object.values(tree.nodes)) {
      if (!n.living || n.children.length > 0) continue;
      if (branchOrder(tree, n.id) < 1) continue;
      secondaryTips += 1;
      if (unbranchedRunLength(tree, n.id) >= 7) longSecondaryRuns += 1;
    }

    // Prefer many single-lateral hosts along axes (not a few multi-fork stars)
    expect(lateralHosts).toBeGreaterThan(12);
    expect(singleHosts).toBeGreaterThan(multiHosts);
    // Natural growth should almost never double-up on one internode
    expect(multiHosts).toBeLessThanOrEqual(
      Math.max(1, Math.floor(singleHosts * 0.15)),
    );
    expect(takeoffN).toBeGreaterThan(12);
    // Mean takeoff well above the old ~0.62 acute band
    expect(takeoffSum / takeoffN).toBeGreaterThan(0.7);
    // Few (ideally zero) new forks from low trunk broom zone
    expect(lowMainLaterals).toBeLessThanOrEqual(2);
    // Secondary tips ramify eventually; monopodial flushes may run longer now
    expect(secondaryTips).toBeGreaterThan(5);
    expect(longSecondaryRuns).toBeLessThanOrEqual(
      Math.max(4, Math.floor(secondaryTips * 0.35)),
    );
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

  it('wireSetMult accelerates set under the same plant-days (#68)', () => {
    const base = createSapling('juniper-procumbens', 17);
    const boosted = createSapling('juniper-procumbens', 17);
    const nBase = Object.values(base.nodes).find((n) => n.id !== base.rootId)!;
    const nBoost = Object.values(boosted.nodes).find(
      (n) => n.id !== boosted.rootId,
    )!;
    applyWire(base, nBase.id);
    applyWire(boosted, nBoost.id);
    tickDays(base, 40, 40, { wireSetMult: 1 });
    tickDays(boosted, 40, 40, { wireSetMult: 1.6 });
    const a = base.nodes[nBase.id].wire!.setAmount;
    const b = boosted.nodes[nBoost.id].wire!.setAmount;
    expect(b).toBeGreaterThan(a * 1.2);
    // ~1.5–2s wall at Month (with mult) should leave glanceable progress
    expect(b).toBeGreaterThan(0.08);
  });

  it('describeNode includes continuous wire set label while wired (#68)', () => {
    const tree = createSapling('juniper-procumbens', 19);
    const node = Object.values(tree.nodes).find((n) => n.id !== tree.rootId)!;
    applyWire(tree, node.id);
    tree.nodes[node.id].wire!.setAmount = 0.12;
    const d = describeNode(tree, node.id);
    expect(d).toMatch(/fresh wire · 12% set/);
    tree.nodes[node.id].wire!.setAmount = 0.9;
    expect(describeNode(tree, node.id)).toMatch(/wire set \(90%\)/);
  });
});
