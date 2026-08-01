/**
 * Optional shokunin practice checklist — pure data, no DOM.
 *
 * Advisory only (no tool locks). Mirrors craftsman phases SK0–SK5 in
 * `shokunin.ts` / `docs/practice-mode.md` with sparse player-facing copy.
 */
import type { TreeState } from '../types';
import { primaryStemNodeIds } from './shokunin';

export type ChecklistStepId =
  | 'front'
  | 'prune'
  | 'wire'
  | 'set'
  | 'grow'
  | 'rest';

export interface ChecklistStep {
  id: ChecklistStepId;
  /** Short list label. */
  label: string;
  /** Status line on tap — present tense, sparse. */
  hint: string;
}

/** Ordered path steps (SK0 → SK5). */
export const CHECKLIST_STEPS: readonly ChecklistStep[] = [
  {
    id: 'front',
    label: 'Choose front',
    hint: 'Orbit until the trunk reads · ink is the front plane',
  },
  {
    id: 'prune',
    label: 'Structural prune',
    hint: 'Cut outside the ink · keep the line',
  },
  {
    id: 'wire',
    label: 'Wire trunk line',
    hint: 'Wire the trunk · drag to set the S-curve',
  },
  {
    id: 'set',
    label: 'Wait for set',
    hint: 'Season or Mo while wire sets · then Unwire',
  },
  {
    id: 'grow',
    label: 'Grow into pads',
    hint: 'Season or Mo into the pad · not only Years',
  },
  {
    id: 'rest',
    label: 'Rest and read',
    hint: 'Still · read the silhouette · leave room',
  },
] as const;

export interface ChecklistSignals {
  /** User orbited / claimed camera (viewing front). */
  cameraOwned: boolean;
  /** Session: at least one successful prune. */
  hasPruned: boolean;
  /** Primary trunk currently has wire. */
  hasTrunkWire: boolean;
  /** Max setAmount among living wired nodes (0–1). */
  maxWireSet: number;
  /** Session: grew under week or month pace (not only Years). */
  usedSeasonPace: boolean;
  /** Session: paused (Still). */
  hasPaused: boolean;
  /** Live practice score 0–1 (soft rest signal at “close”). */
  practiceScore: number;
}

export type ChecklistDone = Record<ChecklistStepId, boolean>;

export function emptyChecklistDone(): ChecklistDone {
  return {
    front: false,
    prune: false,
    wire: false,
    set: false,
    grow: false,
    rest: false,
  };
}

/** Soft auto-progress from session/tree signals. Advisory only. */
export function evaluateChecklistProgress(
  signals: ChecklistSignals,
): ChecklistDone {
  return {
    front: signals.cameraOwned,
    prune: signals.hasPruned,
    wire: signals.hasTrunkWire,
    set: signals.maxWireSet >= 0.45,
    grow: signals.usedSeasonPace,
    // “close” grade or deliberate Still
    rest: signals.hasPaused || signals.practiceScore >= 0.72,
  };
}

/**
 * Merge soft auto progress with optional manual overrides.
 * When an id is present in `override`, that boolean wins.
 */
export function mergeChecklistDone(
  auto: ChecklistDone,
  override: ReadonlyMap<ChecklistStepId, boolean>,
): ChecklistDone {
  const out = emptyChecklistDone();
  for (const step of CHECKLIST_STEPS) {
    out[step.id] = override.has(step.id)
      ? Boolean(override.get(step.id))
      : auto[step.id];
  }
  return out;
}

export function checklistDoneCount(done: ChecklistDone): number {
  let n = 0;
  for (const step of CHECKLIST_STEPS) {
    if (done[step.id]) n += 1;
  }
  return n;
}

export function checklistHint(id: ChecklistStepId): string {
  const step = CHECKLIST_STEPS.find((s) => s.id === id);
  return step?.hint ?? '';
}

/** Tree-derived wire signals (trunk wire + max set). */
export function treeWireSignals(
  tree: TreeState,
): Pick<ChecklistSignals, 'hasTrunkWire' | 'maxWireSet'> {
  const stem = new Set(primaryStemNodeIds(tree));
  let hasTrunkWire = false;
  let maxWireSet = 0;
  for (const n of Object.values(tree.nodes)) {
    if (!n.living || !n.wire) continue;
    maxWireSet = Math.max(maxWireSet, n.wire.setAmount);
    if (stem.has(n.id)) hasTrunkWire = true;
  }
  return { hasTrunkWire, maxWireSet };
}
