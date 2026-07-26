/**
 * Compact transport packing for share links.
 *
 * Full TreeState JSON wastes bytes on long keys, redundant `children`, and
 * full-precision floats. This array format is LZ'd into the URL hash.
 * Unpacked results always restore schemaVersion 1 TreeState for the sim.
 *
 * Transport layout (COMPACT_VERSION = 2):
 * [
 *   2, speciesId, seed, agePlantDays, reserves, rootMass, vigor, nextId, rootId,
 *   nodes: [
 *     [id, parentId|null, L, tL, R, tR, ox,oy,oz,ow, age, lig, living, wound, buds, foliage, wire?],
 *     ...
 *   ]
 * ]
 * buds:    [id, typeCode, stateCode, t, az, ageDays, breakForce]
 * foliage: [id, t, az, ageDays, area, biomass, efficiency, living]
 * wire:    [tox,toy,toz,tow, iox,ioy,ioz,iow, setAmount, installedPlantDay, tension]
 *
 * children[] is rebuilt from parentId on unpack.
 */

import type {
  Bud,
  BudState,
  BudType,
  FoliageCluster,
  Internode,
  NodeId,
  Quat,
  TreeState,
  WireConstraint,
} from '../sim/types';

/** Transport format version (not TreeState.schemaVersion). */
export const COMPACT_VERSION = 2 as const;

const BUD_TYPE_TO_CODE: Record<BudType, number> = {
  terminal: 0,
  axillary: 1,
  adventitious: 2,
};
const BUD_TYPE_FROM_CODE: BudType[] = ['terminal', 'axillary', 'adventitious'];

const BUD_STATE_TO_CODE: Record<BudState, number> = {
  dormant: 0,
  flushing: 1,
  dead: 2,
};
const BUD_STATE_FROM_CODE: BudState[] = ['dormant', 'flushing', 'dead'];

/** Round to `digits` decimal places; non-finite → 0. */
export function quantize(n: number, digits: number): number {
  if (!Number.isFinite(n)) return 0;
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}

function quantizeQuat(q: Quat): Quat {
  const x = quantize(q[0], 5);
  const y = quantize(q[1], 5);
  const z = quantize(q[2], 5);
  const w = quantize(q[3], 5);
  const len = Math.hypot(x, y, z, w) || 1;
  return [x / len, y / len, z / len, w / len];
}

function packBud(b: Bud): unknown[] {
  return [
    b.id,
    BUD_TYPE_TO_CODE[b.type],
    BUD_STATE_TO_CODE[b.state],
    quantize(b.t, 4),
    quantize(b.azimuth, 4),
    Math.round(b.ageDays),
    quantize(b.breakForce, 4),
  ];
}

function packFoliage(f: FoliageCluster): unknown[] {
  return [
    f.id,
    quantize(f.t, 4),
    quantize(f.azimuth, 4),
    Math.round(f.ageDays),
    quantize(f.area, 4),
    quantize(f.biomass, 4),
    quantize(f.efficiency, 4),
    f.living ? 1 : 0,
  ];
}

function packWire(w: WireConstraint): number[] {
  const t = quantizeQuat(w.targetOrientation);
  const i = quantizeQuat(w.installOrientation);
  return [
    t[0],
    t[1],
    t[2],
    t[3],
    i[0],
    i[1],
    i[2],
    i[3],
    quantize(w.setAmount, 4),
    Math.round(w.installedPlantDay),
    quantize(w.tension, 4),
  ];
}

function packNode(n: Internode): unknown[] {
  const o = quantizeQuat(n.orientation);
  const row: unknown[] = [
    n.id,
    n.parentId,
    quantize(n.length, 6),
    quantize(n.targetLength, 6),
    quantize(n.radius, 6),
    quantize(n.targetRadius, 6),
    o[0],
    o[1],
    o[2],
    o[3],
    Math.round(n.ageDays),
    quantize(n.lignification, 4),
    n.living ? 1 : 0,
    quantize(n.wound, 4),
    n.buds.map(packBud),
    n.foliage.map(packFoliage),
  ];
  if (n.wire) row.push(packWire(n.wire));
  return row;
}

/**
 * Pack a TreeState into the compact array transport form (before LZ).
 * Does not mutate the input tree.
 */
export function packTreeCompact(tree: TreeState): unknown[] {
  return [
    COMPACT_VERSION,
    tree.speciesId,
    tree.seed,
    quantize(tree.agePlantDays, 4),
    quantize(tree.reserves, 4),
    quantize(tree.rootMass, 4),
    quantize(tree.vigor, 4),
    tree.nextId,
    tree.rootId,
    Object.values(tree.nodes).map(packNode),
  ];
}

function asNum(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function asStr(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return '';
}

function unpackBud(row: unknown): Bud {
  if (!Array.isArray(row) || row.length < 7) {
    throw new Error('Invalid compact bud');
  }
  const typeCode = asNum(row[1], 0);
  const stateCode = asNum(row[2], 0);
  return {
    id: asStr(row[0]),
    type: BUD_TYPE_FROM_CODE[typeCode] ?? 'axillary',
    state: BUD_STATE_FROM_CODE[stateCode] ?? 'dormant',
    t: asNum(row[3]),
    azimuth: asNum(row[4]),
    ageDays: asNum(row[5]),
    breakForce: asNum(row[6]),
  };
}

function unpackFoliage(row: unknown): FoliageCluster {
  if (!Array.isArray(row) || row.length < 7) {
    throw new Error('Invalid compact foliage');
  }
  return {
    id: asStr(row[0]),
    t: asNum(row[1]),
    azimuth: asNum(row[2]),
    ageDays: asNum(row[3]),
    area: asNum(row[4]),
    biomass: asNum(row[5]),
    efficiency: asNum(row[6]),
    living: row.length < 8 ? true : asNum(row[7], 1) !== 0,
  };
}

function unpackWire(row: unknown): WireConstraint {
  if (!Array.isArray(row) || row.length < 11) {
    throw new Error('Invalid compact wire');
  }
  return {
    targetOrientation: quantizeQuat([
      asNum(row[0]),
      asNum(row[1]),
      asNum(row[2]),
      asNum(row[3]),
    ]),
    installOrientation: quantizeQuat([
      asNum(row[4]),
      asNum(row[5]),
      asNum(row[6]),
      asNum(row[7]),
    ]),
    setAmount: asNum(row[8]),
    installedPlantDay: asNum(row[9]),
    tension: asNum(row[10]),
  };
}

function unpackNode(row: unknown): Internode {
  if (!Array.isArray(row) || row.length < 16) {
    throw new Error('Invalid compact node');
  }
  const parentRaw = row[1];
  const parentId: NodeId | null =
    parentRaw === null || parentRaw === undefined ? null : asStr(parentRaw);

  const budsRaw = row[14];
  const foliageRaw = row[15];
  if (!Array.isArray(budsRaw) || !Array.isArray(foliageRaw)) {
    throw new Error('Invalid compact node buds/foliage');
  }

  const node: Internode = {
    id: asStr(row[0]),
    parentId,
    children: [],
    length: asNum(row[2]),
    targetLength: asNum(row[3]),
    radius: asNum(row[4]),
    targetRadius: asNum(row[5]),
    orientation: quantizeQuat([
      asNum(row[6]),
      asNum(row[7]),
      asNum(row[8]),
      asNum(row[9]),
    ]),
    ageDays: asNum(row[10]),
    lignification: asNum(row[11]),
    living: asNum(row[12], 1) !== 0,
    buds: budsRaw.map(unpackBud),
    foliage: foliageRaw.map(unpackFoliage),
    wound: asNum(row[13]),
  };

  if (row.length > 16 && row[16] != null) {
    node.wire = unpackWire(row[16]);
  }
  return node;
}

/**
 * Unpack compact transport into a schemaVersion 1 TreeState.
 * Rebuilds children[] from parentId links.
 */
export function unpackTreeCompact(data: unknown): TreeState {
  if (!Array.isArray(data) || data.length < 10) {
    throw new Error('Invalid compact tree payload');
  }
  if (data[0] !== COMPACT_VERSION) {
    throw new Error(`Unsupported compact version: ${String(data[0])}`);
  }

  const nodesRaw = data[9];
  if (!Array.isArray(nodesRaw)) {
    throw new Error('Invalid compact nodes list');
  }

  const nodes: Record<NodeId, Internode> = {};
  for (const row of nodesRaw) {
    const node = unpackNode(row);
    nodes[node.id] = node;
  }

  // Rebuild children from parentId
  for (const node of Object.values(nodes)) {
    node.children = [];
  }
  for (const node of Object.values(nodes)) {
    if (node.parentId && nodes[node.parentId]) {
      nodes[node.parentId].children.push(node.id);
    }
  }

  const tree: TreeState = {
    schemaVersion: 1,
    speciesId: asStr(data[1]),
    seed: asNum(data[2]),
    agePlantDays: asNum(data[3]),
    reserves: asNum(data[4]),
    rootMass: asNum(data[5]),
    vigor: asNum(data[6]),
    nextId: asNum(data[7], 1),
    rootId: asStr(data[8]),
    nodes,
  };

  if (!tree.speciesId || !tree.rootId || !nodes[tree.rootId]) {
    throw new Error('Invalid compact tree root/species');
  }
  return tree;
}

/** True when JSON-parsed value is a compact share payload. */
export function isCompactPayload(data: unknown): boolean {
  return Array.isArray(data) && data[0] === COMPACT_VERSION;
}
