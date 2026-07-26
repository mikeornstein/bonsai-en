import { clamp, createRng } from './math';
import { getSpecies } from './species/juniper';
import { environmentAt } from './time';
import {
  addAxillaryBud,
  extendFromBud,
  totalFoliageArea,
  totalWoodyVolume,
} from './tree';
import type { GrowthStats, Internode, TreeState } from './types';

function nodeDepth(tree: TreeState, id: string): number {
  let d = 0;
  let cur: Internode | undefined = tree.nodes[id];
  while (cur?.parentId) {
    d += 1;
    cur = tree.nodes[cur.parentId];
    if (d > 256) break;
  }
  return d;
}

/** Apical dominance: strong terminals suppress lower buds. */
function updateDominanceAndBuds(
  tree: TreeState,
  species: ReturnType<typeof getSpecies>,
  seasonMul: number,
  rng: () => number,
): void {
  // Find active terminals and their suppression field down ancestors
  const suppression = new Map<string, number>();

  for (const node of Object.values(tree.nodes)) {
    if (!node.living) continue;
    const term = node.buds.find(
      (b) => b.type === 'terminal' && b.state === 'flushing',
    );
    if (!term) continue;
    // Walk down toward root, applying decayed suppression to siblings' hosts
    let strength = species.apicalDominance;
    let cur: Internode | undefined = node;
    while (cur && strength > 0.02) {
      if (cur.parentId) {
        const parent: Internode | undefined = tree.nodes[cur.parentId];
        if (!parent) break;
        for (const sibId of parent.children) {
          if (sibId === cur.id) continue;
          const prev = suppression.get(sibId) ?? 0;
          suppression.set(sibId, Math.max(prev, strength * 0.85));
        }
        const prevP = suppression.get(parent.id) ?? 0;
        suppression.set(parent.id, Math.max(prevP, strength * 0.5));
        cur = parent;
      } else {
        break;
      }
      strength *= species.dominanceDecay;
    }
  }

  for (const node of Object.values(tree.nodes)) {
    if (!node.living) continue;
    const sup = suppression.get(node.id) ?? 0;
    for (const bud of node.buds) {
      if (bud.state === 'dead') continue;
      bud.ageDays += 1;

      if (bud.state === 'flushing') {
        // Auto-rest after a short flush pulse so we don't extend every day forever
        if (bud.ageDays > 12 + rng() * 10 || seasonMul < 0.25) {
          bud.state = 'dormant';
          bud.breakForce = 0.15;
          bud.ageDays = 0;
        }
        continue;
      }

      // Dormant buds accumulate break force from season & wounds, reduced by dominance
      const seasonal =
        seasonMul > 0.5 ? 0.01 * seasonMul : 0.0015 * seasonMul;
      const woundBoost = node.wound * 0.08;
      const depthBoost = nodeDepth(tree, node.id) * 0.0008;
      bud.breakForce += (seasonal + woundBoost + depthBoost) * (1 - sup);
      bud.breakForce *= 0.994; // slow decay
      bud.breakForce = clamp(bud.breakForce, 0, 1.5);

      if (
        bud.breakForce >= species.budBreakThreshold &&
        seasonMul > 0.35 &&
        rng() < 0.06 * seasonMul
      ) {
        bud.state = 'flushing';
        bud.ageDays = 0;
      }
    }

    // Chance to form new axillary buds on young nodes during flush
    if (
      seasonMul > 0.6 &&
      node.ageDays < 120 &&
      node.buds.filter((b) => b.type === 'axillary').length < 3 &&
      rng() < species.lateralBudChance * seasonMul
    ) {
      addAxillaryBud(tree, node.id, 0.4 + rng() * 0.5, rng() * Math.PI * 2);
    }

    node.wound = Math.max(0, node.wound * 0.97 - 0.002);
  }
}

function updateFoliage(
  tree: TreeState,
  species: ReturnType<typeof getSpecies>,
  seasonMul: number,
): number {
  let dead = 0;
  for (const node of Object.values(tree.nodes)) {
    if (!node.living) continue;
    for (const f of node.foliage) {
      if (!f.living) continue;
      f.ageDays += 1;
      if (f.ageDays > species.foliageLifespanDays) {
        f.efficiency = Math.max(0.15, f.efficiency - species.foliageSenescenceRate);
      }
      // Stress senescence (deterministic via age hash)
      const noise = ((f.ageDays * 1103515245 + 12345) >>> 0) / 4294967296;
      if (tree.vigor < 0.35 && noise < 0.01) {
        f.efficiency *= 0.95;
      }
      if (f.efficiency < 0.12 || (f.ageDays > species.foliageLifespanDays * 1.4 && seasonMul < 0.3)) {
        if (species.evergreen && f.efficiency > 0.08 && noise > 0.02) {
          continue;
        }
        f.living = false;
        dead += 1;
      }
    }
    // Drop dead foliage periodically to keep arrays small
    if (node.foliage.length > 12) {
      node.foliage = node.foliage.filter((f) => f.living);
    }
  }
  return dead;
}

function pipeModelTargets(
  tree: TreeState,
  species: ReturnType<typeof getSpecies>,
): void {
  // Bottom-up: distal leaf area drives cross-section
  const leafArea = new Map<string, number>();

  const compute = (id: string): number => {
    const node = tree.nodes[id];
    if (!node || !node.living) return 0;
    let area = 0;
    for (const f of node.foliage) {
      if (f.living) area += f.area * f.efficiency;
    }
    for (const c of node.children) {
      area += compute(c);
    }
    leafArea.set(id, area);
    const targetCross = area / species.pipeCoefficient;
    const targetR = Math.sqrt(Math.max(1e-12, targetCross / Math.PI));
    node.targetRadius = clamp(
      Math.max(node.radius * 0.98, targetR),
      0.0006,
      species.maxRadius,
    );
    // Ensure parent thicker than child slightly
    return area;
  };

  compute(tree.rootId);

  // Enforce taper: parent radius >= max child * 1.05
  const enforce = (id: string) => {
    const node = tree.nodes[id];
    if (!node) return;
    for (const c of node.children) enforce(c);
    let maxChild = 0;
    for (const c of node.children) {
      maxChild = Math.max(maxChild, tree.nodes[c]?.targetRadius ?? 0);
    }
    if (maxChild > 0) {
      node.targetRadius = Math.max(node.targetRadius, maxChild * 1.08);
      node.targetRadius = Math.min(node.targetRadius, species.maxRadius);
    }
  };
  enforce(tree.rootId);
  void leafArea;
}

function applyWireAndLignification(
  tree: TreeState,
  species: ReturnType<typeof getSpecies>,
  seasonMul: number,
): void {
  for (const node of Object.values(tree.nodes)) {
    if (!node.living) continue;
    node.ageDays += 1;
    const ligRate = (1 / species.lignificationDays) * (0.5 + 0.5 * seasonMul);
    node.lignification = clamp(node.lignification + ligRate, 0, 1);

    if (node.wire) {
      // Orientation held at target while wired
      node.orientation = [
        node.wire.targetOrientation[0],
        node.wire.targetOrientation[1],
        node.wire.targetOrientation[2],
        node.wire.targetOrientation[3],
      ];
      const setDelta =
        species.wireSetRate *
        (0.4 + 0.6 * seasonMul) *
        (0.5 + node.lignification);
      node.wire.setAmount = clamp(node.wire.setAmount + setDelta, 0, 1);
    }
  }
}

/**
 * Advance the tree by one plant-day. Pure-ish mutation of tree state.
 */
export function tickDay(tree: TreeState): GrowthStats {
  const species = getSpecies(tree.speciesId);
  const env = environmentAt(tree.agePlantDays);
  const seasonMul =
    species.seasonGrowth[env.season] *
    (0.55 + 0.45 * env.temperature) *
    (0.5 + 0.5 * env.light) *
    tree.vigor;

  const rng = createRng(
    (tree.seed + Math.floor(tree.agePlantDays) * 10007) >>> 0,
  );

  const stats: GrowthStats = {
    assimilates: 0,
    maintenance: 0,
    primarySpent: 0,
    secondarySpent: 0,
    newNodes: 0,
    deadFoliage: 0,
  };

  // 1. Carbon balance
  // Scale by 1000 so tiny SI areas produce game-readable budgets.
  const foliage = totalFoliageArea(tree);
  const woodVol = totalWoodyVolume(tree);
  const assimilates =
    foliage *
    1000 *
    species.photosynthesisRate *
    env.light *
    tree.vigor *
    (0.45 + 0.55 * seasonMul);
  let foliageBio = 0;
  for (const n of Object.values(tree.nodes)) {
    for (const f of n.foliage) {
      if (f.living) foliageBio += f.biomass;
    }
  }
  const maintenance =
    woodVol * 1000 * species.woodMaintenance +
    foliageBio * species.foliageMaintenance * 0.0004 +
    0.08; // baseline metabolism
  stats.assimilates = assimilates;
  stats.maintenance = maintenance;

  let pool = tree.reserves + assimilates - maintenance;
  if (pool < 0) {
    tree.vigor = clamp(tree.vigor - 0.004, 0.25, 1);
    // Don't hard-zero forever — keep a trickle so recovery is possible
    tree.reserves = 0;
    pool = Math.max(0, assimilates * 0.15);
  } else {
    tree.vigor = clamp(tree.vigor + 0.003, 0.25, 1);
  }

  const alloc = species.allocation;
  // Always bank some storage even in flush so multi-year sims stay solvent
  const storageBudget = Math.max(pool * alloc.storage, pool * 0.12);
  const spendable = Math.max(0, pool - storageBudget);
  let primaryBudget = spendable * (alloc.primary / (alloc.primary + alloc.secondary + alloc.roots));
  let secondaryBudget =
    spendable * (alloc.secondary / (alloc.primary + alloc.secondary + alloc.roots));
  const rootBudget =
    spendable * (alloc.roots / (alloc.primary + alloc.secondary + alloc.roots));
  primaryBudget *= 0.5 + 0.5 * seasonMul;
  secondaryBudget *= 0.4 + 0.6 * seasonMul;

  // 2. Dominance & buds
  updateDominanceAndBuds(tree, species, seasonMul, rng);

  // 3. Primary growth — extend internodes + flush new nodes
  const nodes = Object.values(tree.nodes);
  for (const node of nodes) {
    if (!node.living) continue;
    // Extend toward target length
    if (node.length < node.targetLength - 1e-6 && primaryBudget > 0) {
      const gap = node.targetLength - node.length;
      const step = Math.min(gap, node.targetLength * 0.08 * seasonMul + 0.0005);
      const cost = step * species.primaryCostPerMeter;
      if (cost <= primaryBudget) {
        node.length += step;
        primaryBudget -= cost;
        stats.primarySpent += cost;
      }
    }

    for (const bud of node.buds) {
      if (bud.state !== 'flushing' || primaryBudget < 0.5) continue;
      // Only one extension attempt per bud while flushing (age gate)
      if (bud.ageDays < 3) continue;
      if (node.length < node.targetLength * 0.85 && bud.type === 'terminal' && node.ageDays > 5) {
        continue;
      }
      // Cost to produce a new internode
      const estLen =
        (species.internodeLength.min + species.internodeLength.max) * 0.5;
      const cost = estLen * species.primaryCostPerMeter * 0.45;
      if (cost > primaryBudget) continue;
      // Cap complexity for real-time mesh + mobile
      if (Object.keys(tree.nodes).length > 280) continue;
      // Limit simultaneous flushes under acceleration
      if (stats.newNodes >= 3) continue;

      const child = extendFromBud(tree, node.id, bud, species, rng);
      if (child) {
        primaryBudget -= cost;
        stats.primarySpent += cost;
        stats.newNodes += 1;
        // Rest this bud after producing a shoot
        bud.state = 'dormant';
        bud.breakForce = 0.05;
        bud.ageDays = 0;
      }
    }
  }

  // 4. Secondary growth (pipe model)
  pipeModelTargets(tree, species);
  for (const node of Object.values(tree.nodes)) {
    if (!node.living || secondaryBudget <= 0) continue;
    if (node.radius >= node.targetRadius - 1e-7) continue;
    const gap = node.targetRadius - node.radius;
    const dr = Math.min(
      gap,
      gap * species.radialGrowthRate * seasonMul + 0.000002,
    );
    const r0 = node.radius;
    const r1 = r0 + dr;
    const dVol = Math.PI * node.length * (r1 * r1 - r0 * r0);
    const cost = dVol * species.secondaryCostPerVolume;
    if (cost <= secondaryBudget && cost > 0) {
      node.radius = r1;
      secondaryBudget -= cost;
      stats.secondarySpent += cost;
    } else if (secondaryBudget > 0 && dVol > 0) {
      const frac = secondaryBudget / cost;
      node.radius = r0 + dr * frac;
      stats.secondarySpent += secondaryBudget;
      secondaryBudget = 0;
    }
  }

  // 5. Roots & storage (unspent growth returns to reserves)
  tree.rootMass += rootBudget * 0.01;
  tree.reserves = clamp(
    storageBudget + primaryBudget * 0.35 + secondaryBudget * 0.35 + rootBudget * 0.15,
    0,
    250,
  );

  // Soft winter cushion: healthy trees keep minimal storage through dormancy /
  // late rest so Years fast-forward does not flash "plant death" (play #32).
  // Real stress (low vigor) still drains freely.
  if (
    (env.season === 'dormant' || env.season === 'rest') &&
    tree.vigor >= 0.55
  ) {
    // ~6.5 at vigor 0.55 → ~8.3 at vigor 1.0 (Fair band, not Low)
    const cushion = 6.5 + 4 * (tree.vigor - 0.55);
    tree.reserves = Math.max(tree.reserves, cushion);
  }

  // 6. Wire set + lignification
  applyWireAndLignification(tree, species, seasonMul);

  // 7. Foliage
  stats.deadFoliage = updateFoliage(tree, species, seasonMul);

  tree.agePlantDays += 1;
  return stats;
}

/**
 * Advance multiple plant-days with fixed 1-day substeps.
 * Caps work per call for UI responsiveness.
 */
export function tickDays(tree: TreeState, days: number, maxSteps = 64): number {
  const steps = Math.min(Math.max(0, Math.floor(days)), maxSteps);
  for (let i = 0; i < steps; i++) {
    tickDay(tree);
  }
  return steps;
}

export function subtreeLeafArea(tree: TreeState, nodeId: string): number {
  return totalFoliageArea(tree, nodeId);
}

export function describeNode(tree: TreeState, nodeId: string): string {
  const n = tree.nodes[nodeId];
  if (!n) return '—';
  // Physical, sparse — no raw node IDs
  const wood =
    n.lignification > 0.7
      ? 'old wood'
      : n.lignification > 0.35
        ? 'setting wood'
        : 'young wood';
  const parts = [wood];
  if (n.wire) {
    parts.push(
      n.wire.setAmount > 0.85 ? 'wire set' : n.wire.setAmount > 0.35 ? 'wiring' : 'fresh wire',
    );
  }
  if (n.wound > 0.4) parts.push('fresh cut');
  else if (n.wound > 0.1) parts.push('healing');
  const flushing = n.buds.some((b) => b.state === 'flushing' || b.breakForce > 0.55);
  if (flushing) parts.push('buds waking');
  if (n.children.length === 0) parts.push('tip');
  return parts.join(' · ');
}
