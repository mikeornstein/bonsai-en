import { describe, expect, it } from 'vitest';
import { createSapling } from './tree';
import { pruneAt } from './tools/prune';
import { applyWire, removeWire } from './tools/wire';
import {
  DEFAULT_HISTORY_DEPTH,
  StructuralHistory,
  cloneTree,
} from './history';
import type { NodeId } from './types';

/** First non-root living child (or grandchild) suitable for prune. */
function findPrunableId(tree: ReturnType<typeof createSapling>): NodeId {
  const root = tree.nodes[tree.rootId];
  const queue = [...root.children];
  while (queue.length) {
    const id = queue.shift()!;
    const n = tree.nodes[id];
    if (n?.living && id !== tree.rootId) return id;
    if (n) queue.push(...n.children);
  }
  throw new Error('No prunable node on sapling');
}

describe('cloneTree', () => {
  it('returns an independent deep copy', () => {
    const tree = createSapling();
    const copy = cloneTree(tree);
    expect(copy).not.toBe(tree);
    expect(copy.nodes).not.toBe(tree.nodes);
    expect(copy.rootId).toBe(tree.rootId);
    expect(Object.keys(copy.nodes).length).toBe(Object.keys(tree.nodes).length);

    const id = findPrunableId(tree);
    pruneAt(tree, id);
    expect(tree.nodes[id]).toBeUndefined();
    expect(copy.nodes[id]).toBeDefined();
  });
});

describe('StructuralHistory', () => {
  it('restores tree structure after prune (push → mutate → pop)', () => {
    const tree = createSapling();
    const id = findPrunableId(tree);
    const beforeCount = Object.keys(tree.nodes).length;
    const history = new StructuralHistory();

    history.push(tree, id, 'Undid last cut');
    const r = pruneAt(tree, id);
    expect(r.ok).toBe(true);
    expect(tree.nodes[id]).toBeUndefined();
    expect(Object.keys(tree.nodes).length).toBeLessThan(beforeCount);

    const snap = history.pop();
    expect(snap).not.toBeNull();
    expect(snap!.undoLabel).toBe('Undid last cut');
    expect(snap!.selected).toBe(id);
    expect(snap!.tree.nodes[id]).toBeDefined();
    expect(Object.keys(snap!.tree.nodes).length).toBe(beforeCount);
  });

  it('restores wires after wire / unwire', () => {
    const tree = createSapling();
    const id = findPrunableId(tree);
    const history = new StructuralHistory();

    history.push(tree, id, 'Undid last wire');
    expect(applyWire(tree, id).ok).toBe(true);
    expect(tree.nodes[id]?.wire).toBeDefined();

    let snap = history.pop()!;
    expect(snap.tree.nodes[id]?.wire).toBeUndefined();

    // Re-apply and snapshot before unwire
    applyWire(tree, id);
    history.push(tree, id, 'Undid last unwire');
    expect(removeWire(tree, id).ok).toBe(true);
    expect(tree.nodes[id]?.wire).toBeUndefined();

    snap = history.pop()!;
    expect(snap.tree.nodes[id]?.wire).toBeDefined();
  });

  it('drops oldest when depth exceeded (capacity ≥ 5)', () => {
    const capacity = 5;
    const history = new StructuralHistory(capacity);
    expect(DEFAULT_HISTORY_DEPTH).toBeGreaterThanOrEqual(5);

    const labels: string[] = [];
    for (let i = 0; i < capacity + 2; i++) {
      const tree = createSapling();
      const label = `undo-${i}`;
      labels.push(label);
      history.push(tree, null, label);
    }
    expect(history.depth).toBe(capacity);

    // Oldest two dropped; first pop is the most recent
    expect(history.pop()!.undoLabel).toBe(labels[labels.length - 1]);
    expect(history.pop()!.undoLabel).toBe(labels[labels.length - 2]);
    // After capacity pops from a full stack starting at index 2 of original pushes
    const remaining: string[] = [];
    while (history.canUndo()) {
      remaining.push(history.pop()!.undoLabel);
    }
    // Remaining were labels[2]..labels[capacity-1] in reverse (we already popped last two)
    // After two pops: labels[2], labels[3] for capacity 5 (indices 0,1 dropped; 4,3 already popped)
    expect(remaining.reverse()).toEqual(labels.slice(2, capacity));
  });

  it('discardLast drops a failed-attempt snapshot', () => {
    const tree = createSapling();
    const history = new StructuralHistory();
    history.push(tree, null, 'Undid last cut');
    expect(history.depth).toBe(1);
    history.discardLast();
    expect(history.canUndo()).toBe(false);
    expect(history.pop()).toBeNull();
  });

  it('clear empties the stack', () => {
    const history = new StructuralHistory();
    history.push(createSapling(), null, 'a');
    history.push(createSapling(), null, 'b');
    history.clear();
    expect(history.depth).toBe(0);
  });
});
