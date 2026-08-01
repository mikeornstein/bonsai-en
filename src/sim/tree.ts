import {
  clamp,
  createRng,
  quatFromAxisAngle,
  quatFromUnitToUnit,
  quatIdentity,
  quatMultiply,
  quatNormalize,
  quatRotateVec3,
  randNormal,
  randRange,
  vec3,
} from './math';
import { getSpecies } from './species/juniper';
import type { SpeciesDefinition } from './species/types';
import type {
  Bud,
  FoliageCluster,
  Internode,
  NodeId,
  Quat,
  TreeState,
  Vec3,
} from './types';

/** Golden angle ≈ 137.5° — successive phyllotactic step around parent axis. */
export const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Wrap angle into [0, 2π). */
export function wrapAzimuth(a: number): number {
  const twoPi = Math.PI * 2;
  let t = a % twoPi;
  if (t < 0) t += twoPi;
  return t;
}

/** Smallest angular distance between two azimuths (radians, in [0, π]). */
export function azimuthSeparation(a: number, b: number): number {
  let d = Math.abs(wrapAzimuth(a) - wrapAzimuth(b));
  if (d > Math.PI) d = Math.PI * 2 - d;
  return d;
}

/**
 * Recover approximate yaw azimuth from a lateral child's local orientation.
 * Parent local +Y is the parent axis; laterals are yaw×pitch of that axis.
 */
export function azimuthFromOrientation(orient: Quat): number {
  const dir = quatRotateVec3(orient, vec3(0, 1, 0));
  return Math.atan2(dir[0], dir[2]);
}

/** Off-axis angle of a child orientation from the parent local axis (radians). */
function offAxisAngle(orient: Quat): number {
  const dir = quatRotateVec3(orient, vec3(0, 1, 0));
  return Math.acos(clamp(dir[1], -1, 1));
}

/**
 * Azimuths already claimed by axillary buds or lateral children on a node.
 * Terminal-like children (near parent axis) are ignored.
 * Pass `excludeBudId` when re-resolving the bud about to flush (avoid self-hit).
 */
export function collectOccupiedAzimuths(
  tree: TreeState,
  node: Internode,
  excludeBudId?: string,
): number[] {
  const az: number[] = [];
  for (const bud of node.buds) {
    if (excludeBudId && bud.id === excludeBudId) continue;
    if (bud.type === 'axillary' && bud.state !== 'dead') {
      az.push(bud.azimuth);
    }
  }
  for (const childId of node.children) {
    const child = tree.nodes[childId];
    if (!child?.living) continue;
    if (offAxisAngle(child.orientation) > 0.25) {
      az.push(azimuthFromOrientation(child.orientation));
    }
  }
  return az;
}

/** Midpoint of the largest unoccupied azimuth gap (open sector preference). */
export function openSectorAzimuth(occupied: number[], rng: () => number): number {
  if (occupied.length === 0) return rng() * Math.PI * 2;
  const sorted = occupied.map(wrapAzimuth).sort((a, b) => a - b);
  let bestGap = -1;
  let bestMid = sorted[0];
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    const b =
      i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + Math.PI * 2;
    const gap = b - a;
    if (gap > bestGap) {
      bestGap = gap;
      bestMid = wrapAzimuth(a + gap * 0.5);
    }
  }
  return bestMid;
}

function minSeparationFromOccupied(candidate: number, occupied: number[]): number {
  if (occupied.length === 0) return Math.PI;
  let minSep = Math.PI;
  for (const o of occupied) {
    minSep = Math.min(minSep, azimuthSeparation(candidate, o));
  }
  return minSep;
}

function phyllotaxisAzimuth(
  mode: SpeciesDefinition['phyllotaxis'],
  index: number,
  base: number,
): number {
  if (mode === 'opposite') {
    return wrapAzimuth(base + index * Math.PI);
  }
  if (mode === 'golden') {
    return wrapAzimuth(base + index * GOLDEN_ANGLE);
  }
  return wrapAzimuth(base);
}

/**
 * Soft free-space probe: short ray along proposed lateral world direction.
 * Returns true when clear of other living segments (excluding parent + its kids).
 * O(nodes) per call; only invoked on rare axillary spawn / lateral flush with
 * a small retry budget — not every growth day for every node.
 */
function freeSpaceClear(
  tree: TreeState,
  parentId: NodeId,
  azimuth: number,
  pitch: number,
  probeRadius: number,
): boolean {
  if (probeRadius <= 0) return true;

  const frames = computeWorldFrames(tree);
  const parentFrame = frames.get(parentId);
  if (!parentFrame) return true;

  const yaw = quatFromAxisAngle(vec3(0, 1, 0), azimuth);
  const pitchQ = quatFromAxisAngle(vec3(1, 0, 0), pitch);
  const localOrient = quatMultiply(yaw, pitchQ);
  const worldOrient = quatMultiply(parentFrame.worldOrientation, localOrient);
  const dir = quatRotateVec3(worldOrient, vec3(0, 1, 0));
  const origin = parentFrame.tip;
  // Probe length ~ short internode; check a few samples along the ray
  const probeLen = Math.max(0.02, probeRadius * 4);
  const samples = 3;
  const skip = new Set<NodeId>([parentId]);
  const parent = tree.nodes[parentId];
  if (parent) {
    for (const c of parent.children) skip.add(c);
    if (parent.parentId) skip.add(parent.parentId);
  }

  for (const [id, frame] of frames) {
    if (skip.has(id)) continue;
    const node = tree.nodes[id];
    if (!node?.living) continue;
    // Cheap reject: far bounding sphere
    const mid: Vec3 = [
      (frame.base[0] + frame.tip[0]) * 0.5,
      (frame.base[1] + frame.tip[1]) * 0.5,
      (frame.base[2] + frame.tip[2]) * 0.5,
    ];
    const dx = mid[0] - origin[0];
    const dy = mid[1] - origin[1];
    const dz = mid[2] - origin[2];
    const far = probeLen + node.length * 0.5 + probeRadius * 2;
    if (dx * dx + dy * dy + dz * dz > far * far) continue;

    for (let s = 1; s <= samples; s++) {
      const t = (s / samples) * probeLen;
      const px = origin[0] + dir[0] * t;
      const py = origin[1] + dir[1] * t;
      const pz = origin[2] + dir[2] * t;
      // Distance from sample point to segment (base→tip)
      const seg = [
        frame.tip[0] - frame.base[0],
        frame.tip[1] - frame.base[1],
        frame.tip[2] - frame.base[2],
      ] as Vec3;
      const segLen2 = seg[0] * seg[0] + seg[1] * seg[1] + seg[2] * seg[2];
      let u = 0;
      if (segLen2 > 1e-18) {
        u = clamp(
          ((px - frame.base[0]) * seg[0] +
            (py - frame.base[1]) * seg[1] +
            (pz - frame.base[2]) * seg[2]) /
            segLen2,
          0,
          1,
        );
      }
      const cx = frame.base[0] + seg[0] * u - px;
      const cy = frame.base[1] + seg[1] * u - py;
      const cz = frame.base[2] + seg[2] * u - pz;
      const dist = Math.hypot(cx, cy, cz);
      // Inflate by segment radius so thick wood blocks more
      if (dist < probeRadius + node.radius) return false;
    }
  }
  return true;
}

/**
 * Choose a lateral azimuth that respects species minSiblingAngle, phyllotaxis,
 * and optional free-space probes. Prefers open sectors on conflict.
 * Pure sim — no Three.js.
 *
 * @param preferred  Starting azimuth (e.g. bud's stored azimuth on flush)
 * @param excludeBudId  Bud being resolved — omitted from occupied set
 */
export function chooseLateralAzimuth(
  tree: TreeState,
  nodeId: NodeId,
  species: SpeciesDefinition,
  rng: () => number,
  preferred?: number,
  excludeBudId?: string,
): number {
  const node = tree.nodes[nodeId];
  if (!node) return preferred ?? rng() * Math.PI * 2;

  const occupied = collectOccupiedAzimuths(tree, node, excludeBudId);
  const minAng = species.minSiblingAngle;
  const retries = Math.max(0, species.branchAzimuthRetries | 0);
  const pitch = species.branchAngle.mean;
  const index = occupied.length;

  const base =
    preferred !== undefined
      ? preferred
      : occupied.length > 0
        ? occupied[0]
        : rng() * Math.PI * 2;

  let bestAz = preferred ?? openSectorAzimuth(occupied, rng);
  let bestScore = -1;

  const tryCandidate = (cand: number): boolean => {
    const az = wrapAzimuth(cand);
    const sep = minSeparationFromOccupied(az, occupied);
    // Score: separation first; free-space is a hard-ish preference
    const clear = freeSpaceClear(
      tree,
      nodeId,
      az,
      pitch,
      species.freeSpaceProbeRadius,
    );
    const score = sep + (clear ? 0.15 : 0);
    if (score > bestScore) {
      bestScore = score;
      bestAz = az;
    }
    return sep + 1e-6 >= minAng && clear;
  };

  // Primary: phyllotactic placement (or preferred / random)
  if (species.phyllotaxis === 'random' && preferred === undefined) {
    if (tryCandidate(rng() * Math.PI * 2)) return bestAz;
  } else if (preferred !== undefined) {
    if (tryCandidate(preferred)) return bestAz;
  } else {
    if (tryCandidate(phyllotaxisAzimuth(species.phyllotaxis, index, base))) {
      return bestAz;
    }
  }

  // Resample: further phyllotactic steps, open sector, then random
  for (let attempt = 1; attempt <= retries; attempt++) {
    let cand: number;
    if (attempt === 1) {
      cand = openSectorAzimuth(occupied, rng);
    } else if (species.phyllotaxis === 'random') {
      cand = rng() * Math.PI * 2;
    } else if (attempt === retries) {
      // Last try: open sector with small jitter
      cand = openSectorAzimuth(occupied, rng) + (rng() - 0.5) * 0.2;
    } else {
      cand =
        phyllotaxisAzimuth(species.phyllotaxis, index + attempt, base) +
        (rng() - 0.5) * 0.15;
    }
    if (tryCandidate(cand)) return bestAz;
  }

  // Best-effort: largest separation found (may still be < min if crowded)
  return bestAz;
}

function allocId(tree: TreeState, prefix: string): string {
  const id = `${prefix}${tree.nextId}`;
  tree.nextId += 1;
  return id;
}

export function createEmptyTree(speciesId: string, seed: number): TreeState {
  return {
    schemaVersion: 1,
    speciesId,
    seed,
    agePlantDays: 0,
    reserves: 12,
    rootMass: 0.8,
    vigor: 0.9,
    nodes: {},
    rootId: '',
    nextId: 1,
  };
}

/**
 * True when a tree can drive the game HUD and renderer.
 * Guards the boot failure mode where the app stays on HTML defaults
 * (Age "0 d", Season "—", dead buttons) because state never initialized.
 */
export function isPlayableTree(
  tree: TreeState | null | undefined,
): tree is TreeState {
  if (!tree || typeof tree !== 'object') return false;
  if (tree.schemaVersion !== 1) return false;
  if (!tree.speciesId || typeof tree.speciesId !== 'string') return false;
  if (!tree.rootId || typeof tree.rootId !== 'string') return false;
  if (!tree.nodes || typeof tree.nodes !== 'object') return false;
  const root = tree.nodes[tree.rootId];
  if (!root || root.id !== tree.rootId) return false;
  if (!root.living) return false;
  if (!(tree.agePlantDays >= 0) || !Number.isFinite(tree.agePlantDays)) {
    return false;
  }
  // At least the root segment must have a positive length to render
  if (!(root.length > 0) || !(root.radius > 0)) return false;
  return true;
}

/**
 * Return tree if playable; otherwise a fresh sapling.
 * Used by Game bootstrap so corrupt autosaves never brick the UI.
 */
export function ensurePlayableTree(
  tree: TreeState | null | undefined,
  speciesId = 'juniper-procumbens',
): { tree: TreeState; recovered: boolean } {
  if (isPlayableTree(tree)) {
    return { tree, recovered: false };
  }
  return { tree: createSapling(speciesId), recovered: true };
}

function makeBud(
  tree: TreeState,
  type: Bud['type'],
  t: number,
  azimuth: number,
  state: Bud['state'] = 'dormant',
): Bud {
  return {
    id: allocId(tree, 'b'),
    type,
    state,
    t,
    azimuth,
    ageDays: 0,
    breakForce: type === 'terminal' ? 0.8 : 0.1,
  };
}

function makeFoliage(
  tree: TreeState,
  t: number,
  azimuth: number,
  area: number,
): FoliageCluster {
  return {
    id: allocId(tree, 'f'),
    t,
    azimuth,
    ageDays: 0,
    area,
    biomass: area * 80,
    efficiency: 1,
    living: true,
  };
}

/**
 * Thinness 0 = trunk-scale wood, 1 = tip-scale. Matches createInternode pad gate.
 */
export function foliageThinness(
  node: Internode,
  species: SpeciesDefinition,
): number {
  return clamp01(
    1 - node.radius / Math.max(species.saplingRadius * 1.15, 1e-6),
  );
}

/** True when this internode should carry scale pads (not thick trunk wood). */
export function nodeCarriesFoliage(
  node: Internode,
  species: SpeciesDefinition,
): boolean {
  if (node.parentId === null) return false;
  return foliageThinness(node, species) >= 0.28;
}

/** Target living pad count for a thin shoot (capped for mesh budget). */
export function targetFoliagePads(
  node: Internode,
  species: SpeciesDefinition,
): number {
  const thinness = foliageThinness(node, species);
  return Math.max(
    1,
    Math.min(
      4,
      Math.round(
        (1.2 + node.length / Math.max(species.internodeLength.max, 1e-6)) *
          (0.5 + 0.7 * thinness),
      ),
    ),
  );
}

/**
 * Attach a fresh foliage pad to a living node (evergreen turnover / recovery).
 */
export function addFoliagePad(
  tree: TreeState,
  nodeId: NodeId,
  area: number,
  t = 0.55,
  azimuth?: number,
): FoliageCluster | null {
  const node = tree.nodes[nodeId];
  if (!node?.living) return null;
  const az =
    azimuth ?? ((node.foliage.length * 2.399) % (Math.PI * 2));
  const pad = makeFoliage(tree, t, az, area);
  node.foliage.push(pad);
  return pad;
}

export function createInternode(
  tree: TreeState,
  parentId: NodeId | null,
  orientation: Quat,
  length: number,
  radius: number,
  species: SpeciesDefinition,
): Internode {
  const id = allocId(tree, 'n');
  const r = Math.max(radius, species.minRadius);
  const node: Internode = {
    id,
    parentId,
    children: [],
    length,
    targetLength: length,
    radius: r,
    targetRadius: r,
    orientation: quatNormalize(orientation),
    ageDays: 0,
    lignification: parentId === null ? 0.4 : 0.05,
    living: true,
    buds: [],
    foliage: [],
    wound: 0,
  };
  tree.nodes[id] = node;
  if (parentId) {
    tree.nodes[parentId].children.push(id);
  }
  // New wood starts dormant; season + resources open buds (prevents daily explosion)
  node.buds.push(makeBud(tree, 'terminal', 1, 0, 'dormant'));
  // Thick trunk wood: sparse/no foliage so bark reads; outer shoots get pads
  const thinness = clamp01(
    1 - r / Math.max(species.saplingRadius * 1.15, 1e-6),
  );
  if (parentId === null) {
    return node;
  }
  if (thinness >= 0.28) {
    const clusters = Math.max(
      1,
      Math.round(
        (1.2 + length / species.internodeLength.max) * (0.5 + 0.7 * thinness),
      ),
    );
    for (let i = 0; i < clusters; i++) {
      const t = 0.4 + (0.55 * i) / Math.max(1, clusters - 1);
      const az = (i * 2.399) % (Math.PI * 2);
      node.foliage.push(
        makeFoliage(
          tree,
          t,
          az,
          species.foliageAreaPerInternode * (0.55 + 0.45 * thinness),
        ),
      );
    }
  }
  return node;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** World-space base position and direction for each node. */
export interface NodeWorld {
  base: Vec3;
  tip: Vec3;
  dir: Vec3;
  worldOrientation: Quat;
}

export function computeWorldFrames(tree: TreeState): Map<NodeId, NodeWorld> {
  const out = new Map<NodeId, NodeWorld>();
  const root = tree.nodes[tree.rootId];
  if (!root) return out;

  const visit = (id: NodeId, base: Vec3, parentWorld: Quat) => {
    const node = tree.nodes[id];
    const worldOrientation = quatMultiply(parentWorld, node.orientation);
    const dir = quatRotateVec3(worldOrientation, vec3(0, 1, 0));
    const tip: Vec3 = [
      base[0] + dir[0] * node.length,
      base[1] + dir[1] * node.length,
      base[2] + dir[2] * node.length,
    ];
    out.set(id, { base, tip, dir, worldOrientation });
    for (const childId of node.children) {
      visit(childId, tip, worldOrientation);
    }
  };

  visit(root.id, vec3(0, 0, 0), quatIdentity());
  return out;
}

export function getSubtreeIds(tree: TreeState, rootId: NodeId): Set<NodeId> {
  const ids = new Set<NodeId>();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    if (ids.has(id)) continue;
    ids.add(id);
    const node = tree.nodes[id];
    if (node) stack.push(...node.children);
  }
  return ids;
}

export function removeSubtree(tree: TreeState, nodeId: NodeId): void {
  const node = tree.nodes[nodeId];
  if (!node) return;
  if (nodeId === tree.rootId) {
    throw new Error('Cannot remove root');
  }
  const ids = getSubtreeIds(tree, nodeId);
  if (node.parentId) {
    const parent = tree.nodes[node.parentId];
    parent.children = parent.children.filter((c) => c !== nodeId);
  }
  for (const id of ids) {
    delete tree.nodes[id];
  }
}

export function totalFoliageArea(tree: TreeState, fromId?: NodeId): number {
  let area = 0;
  const ids = fromId
    ? getSubtreeIds(tree, fromId)
    : new Set(Object.keys(tree.nodes));
  for (const id of ids) {
    const n = tree.nodes[id];
    if (!n?.living) continue;
    for (const f of n.foliage) {
      if (f.living) area += f.area * f.efficiency;
    }
  }
  return area;
}

export function totalWoodyVolume(tree: TreeState): number {
  let v = 0;
  for (const n of Object.values(tree.nodes)) {
    if (!n.living) continue;
    v += Math.PI * n.radius * n.radius * n.length;
  }
  return v;
}

export function countLivingNodes(tree: TreeState): number {
  return Object.values(tree.nodes).filter((n) => n.living).length;
}

export function cloneTree(tree: TreeState): TreeState {
  return structuredClone(tree);
}

/**
 * Generate a young juniper-like sapling ready for training.
 */
export function createSapling(
  speciesId = 'juniper-procumbens',
  seed = (Math.random() * 1e9) | 0,
): TreeState {
  const species = getSpecies(speciesId);
  const tree = createEmptyTree(speciesId, seed);
  const rng = createRng(seed);

  const baseLen = randRange(
    rng,
    species.internodeLength.min,
    species.internodeLength.max,
  );
  let radius = species.saplingRadius;
  let parent: Internode | null = null;

  for (let i = 0; i < species.saplingStemNodes; i++) {
    const lean = quatFromAxisAngle(
      vec3(rng() - 0.5, 0, rng() - 0.5),
      randNormal(rng, 0.04, 0.03),
    );
    const orient =
      i === 0
        ? quatFromAxisAngle(vec3(1, 0, 0), randNormal(rng, 0.08, 0.04))
        : lean;
    const len = baseLen * randRange(rng, 0.85, 1.15);
    radius = Math.max(species.saplingRadius * 0.45, radius * 0.88);
    const node = createInternode(
      tree,
      parent?.id ?? null,
      orient,
      len,
      radius,
      species,
    );
    if (i === 0) tree.rootId = node.id;
    node.ageDays = (species.saplingStemNodes - i) * 25;
    node.lignification = Math.min(0.7, 0.15 + i * 0.05);
    parent = node;
  }

  const stemIds: NodeId[] = [];
  let cursor: NodeId | null = tree.rootId;
  while (cursor) {
    stemIds.push(cursor);
    const n: Internode = tree.nodes[cursor];
    // Main stem was built as a single chain; take first child if present
    cursor = n.children[0] ?? null;
    if (stemIds.length > species.saplingStemNodes + 2) break;
  }

  let laterals = 0;
  // Place laterals on mid-upper stem for a readable bonsai silhouette
  const lateralHosts = stemIds.slice(2, Math.max(3, stemIds.length - 1));
  for (
    let i = 0;
    i < lateralHosts.length && laterals < species.saplingLaterals;
    i++
  ) {
    const host = tree.nodes[lateralHosts[i]];
    if (!host) continue;
    const az =
      laterals * ((Math.PI * 2) / Math.max(1, species.saplingLaterals)) +
      randNormal(rng, 0, 0.25);
    const angle = Math.max(
      0.35,
      randNormal(rng, species.branchAngle.mean, species.branchAngle.std),
    );
    const yaw = quatFromAxisAngle(vec3(0, 1, 0), az);
    const pitch = quatFromAxisAngle(vec3(1, 0, 0), angle);
    const orient = quatMultiply(yaw, pitch);
    const len =
      randRange(rng, species.internodeLength.min, species.internodeLength.max) *
      randRange(rng, 0.95, 1.25);
    // Extra mid segment restores lateral reach at half internode length (#83)
    const lat = createInternode(
      tree,
      host.id,
      orient,
      len,
      host.radius * 0.58,
      species,
    );
    lat.ageDays = 20 + rng() * 30;
    const midOrient = quatFromAxisAngle(
      vec3(rng() - 0.5, 0, rng() - 0.5),
      randNormal(rng, 0.12, 0.05),
    );
    const mid = createInternode(
      tree,
      lat.id,
      midOrient,
      len * randRange(rng, 0.8, 1.0),
      lat.radius * 0.82,
      species,
    );
    mid.ageDays = 15 + rng() * 25;
    // Tip for pad mass
    const tipOrient = quatFromAxisAngle(
      vec3(rng() - 0.5, 0, rng() - 0.5),
      randNormal(rng, 0.2, 0.08),
    );
    const tip = createInternode(
      tree,
      mid.id,
      tipOrient,
      len * randRange(rng, 0.65, 0.9),
      mid.radius * 0.72,
      species,
    );
    tip.ageDays = 10 + rng() * 20;
    // Occasional distal tip
    if (rng() > 0.4) {
      createInternode(
        tree,
        tip.id,
        quatFromAxisAngle(vec3(rng() - 0.5, 0, rng() - 0.5), 0.18),
        len * 0.5,
        tip.radius * 0.75,
        species,
      );
    }
    laterals += 1;
  }

  for (const n of Object.values(tree.nodes)) {
    for (const b of n.buds) {
      if (b.type === 'terminal' && n.children.length > 0) {
        b.state = 'dormant';
        b.breakForce = 0.2;
      }
    }
  }

  // Clear foliage from lower ~40% of stem so the trunk line is readable
  const clearStem = Math.max(3, Math.floor(stemIds.length * 0.4));
  for (let i = 0; i < Math.min(clearStem, stemIds.length); i++) {
    const n = tree.nodes[stemIds[i]];
    if (n) n.foliage = [];
  }

  const tips = Object.values(tree.nodes).filter((n) => n.children.length === 0);
  for (const tip of tips) {
    const term = tip.buds.find((b) => b.type === 'terminal');
    if (term) {
      // Ready to flush when season/sim allows, not free-running
      term.state = 'dormant';
      term.breakForce = 0.5;
    }
  }
  // One leader actively flushing so the sapling isn't static
  if (tips[0]) {
    const term = tips[0].buds.find((b) => b.type === 'terminal');
    if (term) {
      term.state = 'flushing';
      term.breakForce = 0.9;
    }
  }

  tree.agePlantDays = 120;
  tree.reserves = 18;
  tree.rootMass = 1.2;
  return tree;
}

/**
 * Bend a node so its world direction approaches `worldDir` (unit-ish).
 * Updates wire target if wired.
 */
export function bendNodeToward(
  tree: TreeState,
  nodeId: NodeId,
  worldDir: Vec3,
): void {
  const frames = computeWorldFrames(tree);
  const node = tree.nodes[nodeId];
  if (!node?.living) return;

  let parentWorld = quatIdentity();
  if (node.parentId) {
    parentWorld =
      frames.get(node.parentId)?.worldOrientation ?? quatIdentity();
  }
  const inv: Quat = [
    -parentWorld[0],
    -parentWorld[1],
    -parentWorld[2],
    parentWorld[3],
  ];
  const localDir = quatRotateVec3(inv, worldDir);
  node.orientation = needQuatFromUnitSafe(localDir);

  if (node.wire) {
    node.wire.targetOrientation = [
      node.orientation[0],
      node.orientation[1],
      node.orientation[2],
      node.orientation[3],
    ];
    node.wire.tension = Math.min(1, node.wire.tension + 0.05);
  }
}

function needQuatFromUnitSafe(localDir: Vec3): Quat {
  return quatFromUnitToUnit(vec3(0, 1, 0), localDir);
}

export function extendFromBud(
  tree: TreeState,
  nodeId: NodeId,
  bud: Bud,
  species: SpeciesDefinition,
  rng: () => number,
): Internode | null {
  const parent = tree.nodes[nodeId];
  if (!parent?.living || bud.state === 'dead') return null;
  if (parent.children.length >= species.maxChildren && bud.type !== 'terminal') {
    return null;
  }

  let orient = quatIdentity();
  if (bud.type === 'terminal') {
    orient = quatFromAxisAngle(
      vec3(rng() - 0.5, 0, rng() - 0.5),
      randNormal(rng, 0.05, 0.04),
    );
  } else {
    // Re-resolve azimuth against current siblings (children + other buds)
    // so delayed flushes still honor minSiblingAngle / free-space.
    const azimuth = chooseLateralAzimuth(
      tree,
      nodeId,
      species,
      rng,
      bud.azimuth,
      bud.id,
    );
    bud.azimuth = azimuth;
    const angle = randNormal(
      rng,
      species.branchAngle.mean,
      species.branchAngle.std,
    );
    const yaw = quatFromAxisAngle(vec3(0, 1, 0), azimuth);
    const pitch = quatFromAxisAngle(vec3(1, 0, 0), angle);
    orient = quatMultiply(yaw, pitch);
  }

  const len = randRange(
    rng,
    species.internodeLength.min,
    species.internodeLength.max,
  );
  // Species tip floor (was hard 0.0008) — allows fine laterals (#58)
  const radius = Math.max(species.minRadius, parent.radius * 0.62);
  const child = createInternode(
    tree,
    parent.id,
    orient,
    0.0001,
    radius,
    species,
  );
  child.targetLength = len;
  child.foliage = [
    makeFoliage(
      tree,
      0.6,
      rng() * Math.PI * 2,
      species.foliageAreaPerInternode,
    ),
  ];

  bud.state = 'dormant';
  bud.breakForce = 0;
  return child;
}

export function addAxillaryBud(
  tree: TreeState,
  nodeId: NodeId,
  t: number,
  azimuth: number,
): Bud | null {
  const node = tree.nodes[nodeId];
  if (!node?.living) return null;
  const bud = makeBud(tree, 'axillary', t, azimuth, 'dormant');
  node.buds.push(bud);
  return bud;
}
