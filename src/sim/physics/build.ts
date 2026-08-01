import type { TreeState } from '../types';
import {
  bendDamping,
  bendStiffness,
  rotationalInertia,
} from './material';
import { computeDistalMasses, localMass } from './mass';
import {
  DEFAULT_PHYSICS_CONFIG,
  type JointRuntime,
  type PhysicsConfig,
  type PhysicsWorld,
} from './types';

function topologyKey(tree: TreeState): string {
  // node ids + lengths/radii fingerprint — enough to know when to rebind
  const ids = Object.keys(tree.nodes).sort();
  let h = `${tree.rootId}|${ids.length}|`;
  for (const id of ids) {
    const n = tree.nodes[id];
    h += `${id}:${n.length.toFixed(5)}:${n.radius.toFixed(5)}:${n.children.length};`;
  }
  return h;
}

function makeJoint(
  tree: TreeState,
  id: string,
  cfg: PhysicsConfig,
  local: Map<string, number>,
  distal: Map<string, number>,
  prev?: JointRuntime,
): JointRuntime {
  const node = tree.nodes[id];
  const mass = local.get(id) ?? 0;
  const dMass = distal.get(id) ?? mass;
  const k = bendStiffness(node, cfg);
  const J = rotationalInertia(dMass, node.length, mass, k, cfg.fixedDt);
  const c = bendDamping(k, J, node, cfg);
  return {
    nodeId: id,
    parentId: node.parentId,
    children: [...node.children],
    thetaX: prev?.thetaX ?? 0,
    thetaZ: prev?.thetaZ ?? 0,
    omegaX: prev?.omegaX ?? 0,
    omegaZ: prev?.omegaZ ?? 0,
    mass,
    length: node.length,
    radius: node.radius,
    lignification: node.lignification,
    wired: Boolean(node.wire),
    k,
    c,
    J,
    quietFrames: prev?.quietFrames ?? 0,
    sleeping: prev?.sleeping ?? false,
  };
}

export function createPhysicsWorld(
  tree: TreeState,
  partial?: Partial<PhysicsConfig>,
): PhysicsWorld {
  const config: PhysicsConfig = { ...DEFAULT_PHYSICS_CONFIG, ...partial };
  // Legacy: `dampingRatio` alone used to set uniform ζ — keep that working.
  if (
    partial &&
    partial.dampingRatio != null &&
    partial.dampingRatioGreen == null &&
    partial.dampingRatioLignified == null
  ) {
    config.dampingRatioGreen = partial.dampingRatio;
    config.dampingRatioLignified = partial.dampingRatio;
  }
  const world: PhysicsWorld = {
    joints: new Map(),
    rootId: tree.rootId,
    config,
    contacts: [],
    topologyKey: '',
    frozen: config.frozen,
    simTime: 0,
  };
  syncPhysicsWorld(world, tree);
  return world;
}

/**
 * Rebuild joint graph from tree. Preserves elastic state for surviving nodes
 * so prune rebound and continuous sag work correctly.
 */
export function syncPhysicsWorld(world: PhysicsWorld, tree: TreeState): void {
  const cfg = world.config;
  const local = new Map<string, number>();
  for (const [id, node] of Object.entries(tree.nodes)) {
    if (!node.living) continue;
    local.set(id, localMass(node, cfg));
  }
  const distal = computeDistalMasses(tree, local);
  const prev = world.joints;
  const next = new Map<string, JointRuntime>();

  for (const id of Object.keys(tree.nodes)) {
    const node = tree.nodes[id];
    if (!node?.living) continue;
    next.set(id, makeJoint(tree, id, cfg, local, distal, prev.get(id)));
  }

  // Zero elastic DOF when rest orientation was just structurally rewritten
  // is handled by callers (wire bend). Here we only drop removed nodes.

  world.joints = next;
  world.rootId = tree.rootId;
  world.topologyKey = topologyKey(tree);
  world.contacts = [];
}

/** Call after structural orientation edits (wire bend) so physics doesn't fight. */
export function resetJointElastic(world: PhysicsWorld, nodeId: string): void {
  const j = world.joints.get(nodeId);
  if (!j) return;
  j.thetaX = 0;
  j.thetaZ = 0;
  j.omegaX = 0;
  j.omegaZ = 0;
  j.quietFrames = 0;
  j.sleeping = false;
}

/** Wake every joint (e.g. after prune / camera whoosh). */
export function wakeAllJoints(world: PhysicsWorld): void {
  for (const j of world.joints.values()) {
    j.sleeping = false;
    j.quietFrames = 0;
  }
}

export function freezePhysics(world: PhysicsWorld, frozen = true): void {
  world.frozen = frozen;
  world.config.frozen = frozen;
  if (frozen) {
    for (const j of world.joints.values()) {
      j.omegaX = 0;
      j.omegaZ = 0;
    }
  }
}

export function isPhysicsSettled(world: PhysicsWorld, eps = 0.02): boolean {
  for (const j of world.joints.values()) {
    if (j.parentId === null) continue;
    if (j.sleeping) continue;
    if (Math.abs(j.omegaX) > eps || Math.abs(j.omegaZ) > eps) return false;
  }
  return true;
}
