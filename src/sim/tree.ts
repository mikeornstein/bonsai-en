import {
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

export function createInternode(
  tree: TreeState,
  parentId: NodeId | null,
  orientation: Quat,
  length: number,
  radius: number,
  species: SpeciesDefinition,
): Internode {
  const id = allocId(tree, 'n');
  const node: Internode = {
    id,
    parentId,
    children: [],
    length,
    targetLength: length,
    radius,
    targetRadius: radius,
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
    1 - radius / Math.max(species.saplingRadius * 1.15, 1e-6),
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
    const lat = createInternode(
      tree,
      host.id,
      orient,
      len,
      host.radius * 0.58,
      species,
    );
    lat.ageDays = 20 + rng() * 30;
    // Always a second-order tip for pad mass
    const tipOrient = quatFromAxisAngle(
      vec3(rng() - 0.5, 0, rng() - 0.5),
      randNormal(rng, 0.2, 0.08),
    );
    const tip = createInternode(
      tree,
      lat.id,
      tipOrient,
      len * randRange(rng, 0.65, 0.9),
      lat.radius * 0.72,
      species,
    );
    tip.ageDays = 10 + rng() * 20;
    // Occasional third-order tip
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

  // Clear foliage from lower stem so the trunk line is readable
  for (let i = 0; i < Math.min(3, stemIds.length); i++) {
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
    const angle = randNormal(
      rng,
      species.branchAngle.mean,
      species.branchAngle.std,
    );
    const yaw = quatFromAxisAngle(vec3(0, 1, 0), bud.azimuth);
    const pitch = quatFromAxisAngle(vec3(1, 0, 0), angle);
    orient = quatMultiply(yaw, pitch);
  }

  const len = randRange(
    rng,
    species.internodeLength.min,
    species.internodeLength.max,
  );
  const radius = Math.max(0.0008, parent.radius * 0.62);
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
