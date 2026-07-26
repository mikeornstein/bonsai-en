import { clamp } from '../math';
import { getSpecies } from '../species/juniper';
import { removeSubtree } from '../tree';
import type { NodeId, TreeState } from '../types';

export interface PruneResult {
  ok: boolean;
  message: string;
  removed: number;
}

/**
 * Hard prune: remove the selected node and everything distal to it.
 * Stimulates buds on the parent (back-budding).
 */
export function pruneAt(tree: TreeState, nodeId: NodeId): PruneResult {
  const node = tree.nodes[nodeId];
  if (!node) return { ok: false, message: 'No branch selected', removed: 0 };
  if (nodeId === tree.rootId) {
    return { ok: false, message: 'Cannot prune the trunk base', removed: 0 };
  }
  if (!node.living) {
    return { ok: false, message: 'Branch already dead', removed: 0 };
  }

  const species = getSpecies(tree.speciesId);
  const parentId = node.parentId;
  const removed = countSubtree(tree, nodeId);
  removeSubtree(tree, nodeId);

  if (parentId && tree.nodes[parentId]) {
    const parent = tree.nodes[parentId];
    parent.wound = clamp(parent.wound + 0.7, 0, 1);
    // Stimulate axillary and terminal buds on parent
    for (const bud of parent.buds) {
      if (bud.state === 'dead') continue;
      bud.breakForce = clamp(
        bud.breakForce + species.pruneStimulus,
        0,
        1.5,
      );
      // Tip cut: encourage nearby laterals
      if (bud.type === 'axillary') {
        bud.breakForce = clamp(
          bud.breakForce + species.pruneStimulus * 0.5,
          0,
          1.5,
        );
      }
    }
    // If parent has no children left, re-activate terminal if present
    if (parent.children.length === 0) {
      const term = parent.buds.find((b) => b.type === 'terminal');
      if (term && term.state !== 'dead') {
        term.state = 'flushing';
        term.breakForce = Math.max(term.breakForce, 0.85);
      }
    }
  }

  return {
    ok: true,
    message: `Pruned ${removed} segment${removed === 1 ? '' : 's'}`,
    removed,
  };
}

/**
 * Soft pinch: remove only the terminal bud / tip growth potential without
 * deleting the whole internode — shortens target length and stimulates laterals.
 */
export function pinchAt(tree: TreeState, nodeId: NodeId): PruneResult {
  const node = tree.nodes[nodeId];
  if (!node) return { ok: false, message: 'No branch selected', removed: 0 };
  if (!node.living) {
    return { ok: false, message: 'Branch already dead', removed: 0 };
  }

  const species = getSpecies(tree.speciesId);

  // If has children, pinch acts on the most distal tip — pick first leaf child path
  let tip = node;
  while (tip.children.length > 0) {
    const next = tree.nodes[tip.children[0]];
    if (!next) break;
    tip = next;
  }

  // Remove children of tip if any tiny new shoots
  for (const c of [...tip.children]) {
    removeSubtree(tree, c);
  }

  const term = tip.buds.find((b) => b.type === 'terminal');
  if (term) {
    term.state = 'dormant';
    term.breakForce = 0.15;
  }
  tip.targetLength = Math.min(tip.targetLength, tip.length * 0.98);
  tip.wound = clamp(tip.wound + 0.25, 0, 1);

  for (const bud of tip.buds) {
    if (bud.type === 'axillary' && bud.state !== 'dead') {
      bud.breakForce = clamp(
        bud.breakForce + species.pruneStimulus * 0.65,
        0,
        1.5,
      );
    }
  }
  // Also stimulate parent laterals
  if (tip.parentId) {
    const p = tree.nodes[tip.parentId];
    for (const bud of p.buds) {
      if (bud.type === 'axillary') {
        bud.breakForce = clamp(
          bud.breakForce + species.pruneStimulus * 0.35,
          0,
          1.5,
        );
      }
    }
  }

  return { ok: true, message: 'Pinched tip', removed: 0 };
}

function countSubtree(tree: TreeState, nodeId: NodeId): number {
  let n = 0;
  const stack = [nodeId];
  while (stack.length) {
    const id = stack.pop()!;
    const node = tree.nodes[id];
    if (!node) continue;
    n += 1;
    stack.push(...node.children);
  }
  return n;
}
