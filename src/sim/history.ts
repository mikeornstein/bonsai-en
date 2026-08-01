import { parseTree, serializeTree } from './serialize';
import type { NodeId, TreeState } from './types';

/** Default undo stack capacity (issue #67: depth ≥ 5). */
export const DEFAULT_HISTORY_DEPTH = 8;

/** One pre-edit snapshot for structural tools (prune / pinch / wire / unwire / bend). */
export interface StructuralSnapshot {
  tree: TreeState;
  selected: NodeId | null;
  /** Quiet status line shown when this snapshot is restored. */
  undoLabel: string;
}

/** Deep-clone TreeState via JSON (full-fidelity, no Three.js). */
export function cloneTree(tree: TreeState): TreeState {
  return parseTree(serializeTree(tree));
}

/**
 * Bounded stack of structural snapshots. Pure data — Game owns when to push
 * (before mutate) and how to rebind physics / scene after pop.
 */
export class StructuralHistory {
  private stack: StructuralSnapshot[] = [];

  constructor(private readonly maxDepth: number = DEFAULT_HISTORY_DEPTH) {
    if (maxDepth < 1) {
      throw new Error('StructuralHistory maxDepth must be ≥ 1');
    }
  }

  get depth(): number {
    return this.stack.length;
  }

  canUndo(): boolean {
    return this.stack.length > 0;
  }

  /**
   * Snapshot current tree + selection before a structural edit.
   * Oldest entry drops when capacity is exceeded.
   */
  push(tree: TreeState, selected: NodeId | null, undoLabel: string): void {
    this.stack.push({
      tree: cloneTree(tree),
      selected,
      undoLabel,
    });
    while (this.stack.length > this.maxDepth) {
      this.stack.shift();
    }
  }

  /** Pop the most recent snapshot, or null if empty. */
  pop(): StructuralSnapshot | null {
    return this.stack.pop() ?? null;
  }

  /**
   * Drop the most recent snapshot without restoring (failed tool attempt after push).
   */
  discardLast(): void {
    this.stack.pop();
  }

  clear(): void {
    this.stack.length = 0;
  }
}
