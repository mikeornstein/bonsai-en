import type { Internode, TreeState } from '../types';
import type { PhysicsConfig } from './types';

/** Wood mass from cylindrical volume. */
export function woodMass(node: Internode, cfg: PhysicsConfig): number {
  const vol = Math.PI * node.radius * node.radius * Math.max(node.length, 0);
  return cfg.woodDensity * vol;
}

/** Foliage mass lumped onto the host internode. */
export function foliageMass(node: Internode, cfg: PhysicsConfig): number {
  let m = 0;
  for (const f of node.foliage) {
    if (f.living) m += f.biomass * cfg.foliageMassScale;
  }
  return m;
}

export function localMass(node: Internode, cfg: PhysicsConfig): number {
  return woodMass(node, cfg) + foliageMass(node, cfg);
}

/**
 * Bottom-up distal mass: self + all living descendants.
 * `local` map must already hold per-node local masses.
 */
export function computeDistalMasses(
  tree: TreeState,
  local: Map<string, number>,
): Map<string, number> {
  const distal = new Map<string, number>();

  const visit = (id: string): number => {
    const node = tree.nodes[id];
    if (!node || !node.living) {
      distal.set(id, 0);
      return 0;
    }
    let sum = local.get(id) ?? 0;
    for (const c of node.children) {
      sum += visit(c);
    }
    distal.set(id, sum);
    return sum;
  };

  if (tree.rootId) visit(tree.rootId);
  return distal;
}
