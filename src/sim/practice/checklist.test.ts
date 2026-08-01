import { describe, expect, it } from 'vitest';
import { createSapling } from '../tree';
import { applyWire } from '../tools/wire';
import { primaryStemNodeIds } from './shokunin';
import {
  CHECKLIST_STEPS,
  checklistDoneCount,
  checklistHint,
  emptyChecklistDone,
  evaluateChecklistProgress,
  mergeChecklistDone,
  treeWireSignals,
  type ChecklistStepId,
} from './checklist';

describe('practice checklist', () => {
  it('exposes six ordered steps with sparse labels and hints', () => {
    expect(CHECKLIST_STEPS).toHaveLength(6);
    expect(CHECKLIST_STEPS.map((s) => s.id)).toEqual([
      'front',
      'prune',
      'wire',
      'set',
      'grow',
      'rest',
    ]);
    for (const step of CHECKLIST_STEPS) {
      expect(step.label.length).toBeGreaterThan(3);
      expect(step.hint.length).toBeGreaterThan(8);
      // Sparse: no tutorial paragraphs
      expect(step.hint.length).toBeLessThan(90);
    }
  });

  it('evaluateChecklistProgress marks soft signals only', () => {
    const none = evaluateChecklistProgress({
      cameraOwned: false,
      hasPruned: false,
      hasTrunkWire: false,
      maxWireSet: 0,
      usedSeasonPace: false,
      hasPaused: false,
      practiceScore: 0.2,
    });
    expect(checklistDoneCount(none)).toBe(0);

    const some = evaluateChecklistProgress({
      cameraOwned: true,
      hasPruned: true,
      hasTrunkWire: true,
      maxWireSet: 0.5,
      usedSeasonPace: true,
      hasPaused: false,
      practiceScore: 0.5,
    });
    expect(some.front).toBe(true);
    expect(some.prune).toBe(true);
    expect(some.wire).toBe(true);
    expect(some.set).toBe(true);
    expect(some.grow).toBe(true);
    expect(some.rest).toBe(false);

    const restByScore = evaluateChecklistProgress({
      cameraOwned: false,
      hasPruned: false,
      hasTrunkWire: false,
      maxWireSet: 0,
      usedSeasonPace: false,
      hasPaused: false,
      practiceScore: 0.75,
    });
    expect(restByScore.rest).toBe(true);

    const restByPause = evaluateChecklistProgress({
      cameraOwned: false,
      hasPruned: false,
      hasTrunkWire: false,
      maxWireSet: 0,
      usedSeasonPace: false,
      hasPaused: true,
      practiceScore: 0.1,
    });
    expect(restByPause.rest).toBe(true);
  });

  it('mergeChecklistDone prefers manual override', () => {
    const auto = emptyChecklistDone();
    auto.prune = true;
    const override = new Map<ChecklistStepId, boolean>([
      ['prune', false],
      ['front', true],
    ]);
    const merged = mergeChecklistDone(auto, override);
    expect(merged.prune).toBe(false);
    expect(merged.front).toBe(true);
    expect(merged.wire).toBe(false);
  });

  it('checklistHint returns step copy', () => {
    expect(checklistHint('wire')).toMatch(/trunk/i);
    expect(checklistHint('grow')).toMatch(/Season|Mo/);
  });

  it('treeWireSignals detects primary-stem wire and set amount', () => {
    const tree = createSapling('juniper-procumbens', 7);
    const fresh = treeWireSignals(tree);
    expect(fresh.hasTrunkWire).toBe(false);
    expect(fresh.maxWireSet).toBe(0);

    const stem = primaryStemNodeIds(tree);
    expect(stem.length).toBeGreaterThan(0);
    const r = applyWire(tree, stem[0]);
    expect(r.ok).toBe(true);
    tree.nodes[stem[0]].wire!.setAmount = 0.6;
    const wired = treeWireSignals(tree);
    expect(wired.hasTrunkWire).toBe(true);
    expect(wired.maxWireSet).toBeCloseTo(0.6, 5);
  });
});
