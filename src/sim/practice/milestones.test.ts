import { describe, expect, it } from 'vitest';
import {
  createPracticeMilestoneState,
  observePracticeScore,
  PRACTICE_MILESTONE_COPY,
  resetPracticeMilestones,
  seedPracticeScore,
} from './milestones';
import { PRACTICE_GRADE_THRESHOLDS } from './score';

describe('practice grade milestones', () => {
  it('does not fire below close threshold', () => {
    const st = createPracticeMilestoneState();
    expect(observePracticeScore(st, 0.4)).toBeNull();
    expect(observePracticeScore(st, PRACTICE_GRADE_THRESHOLDS.close - 0.001)).toBeNull();
    expect(st.firedClose).toBe(false);
    expect(st.firedMatch).toBe(false);
    expect(st.bestScore).toBeCloseTo(PRACTICE_GRADE_THRESHOLDS.close - 0.001, 5);
  });

  it('fires close once when best first reaches close', () => {
    const st = createPracticeMilestoneState();
    const ev = observePracticeScore(st, PRACTICE_GRADE_THRESHOLDS.close);
    expect(ev).toEqual({
      kind: 'close',
      message: PRACTICE_MILESTONE_COPY.close,
    });
    expect(st.firedClose).toBe(true);
    expect(st.firedMatch).toBe(false);
  });

  it('does not re-fire close when score oscillates around the boundary', () => {
    const st = createPracticeMilestoneState();
    expect(observePracticeScore(st, 0.73)?.kind).toBe('close');
    // Drop below, rise again
    expect(observePracticeScore(st, 0.7)).toBeNull();
    expect(observePracticeScore(st, 0.75)).toBeNull();
    expect(observePracticeScore(st, 0.71)).toBeNull();
    expect(observePracticeScore(st, 0.8)).toBeNull();
    expect(st.firedClose).toBe(true);
    expect(st.firedMatch).toBe(false);
    // best tracks peak
    expect(st.bestScore).toBeCloseTo(0.8, 5);
  });

  it('fires match once when best first reaches match', () => {
    const st = createPracticeMilestoneState();
    observePracticeScore(st, 0.75); // close first
    const ev = observePracticeScore(st, PRACTICE_GRADE_THRESHOLDS.match);
    expect(ev).toEqual({
      kind: 'match',
      message: PRACTICE_MILESTONE_COPY.match,
    });
    expect(st.firedMatch).toBe(true);
    // No second match
    expect(observePracticeScore(st, 0.95)).toBeNull();
    expect(observePracticeScore(st, 0.7)).toBeNull();
    expect(observePracticeScore(st, 0.9)).toBeNull();
  });

  it('jumping straight to match fires match only and marks close fired', () => {
    const st = createPracticeMilestoneState();
    const ev = observePracticeScore(st, 0.9);
    expect(ev?.kind).toBe('match');
    expect(st.firedClose).toBe(true);
    expect(st.firedMatch).toBe(true);
    // Would have been close range — already marked
    expect(observePracticeScore(st, 0.75)).toBeNull();
  });

  it('uses best-so-far: current score below close after a peak does not re-fire', () => {
    const st = createPracticeMilestoneState();
    observePracticeScore(st, 0.74);
    expect(observePracticeScore(st, 0.5)).toBeNull();
    expect(st.bestScore).toBeCloseTo(0.74, 5);
  });

  it('reset clears flags and best so a new sapling can celebrate again', () => {
    const st = createPracticeMilestoneState();
    observePracticeScore(st, 0.85);
    expect(st.firedMatch).toBe(true);
    resetPracticeMilestones(st);
    expect(st.bestScore).toBe(0);
    expect(st.firedClose).toBe(false);
    expect(st.firedMatch).toBe(false);
    expect(observePracticeScore(st, 0.73)?.kind).toBe('close');
  });

  it('ignores non-finite scores', () => {
    const st = createPracticeMilestoneState();
    expect(observePracticeScore(st, Number.NaN)).toBeNull();
    expect(observePracticeScore(st, Number.POSITIVE_INFINITY)).toBeNull();
    expect(st.bestScore).toBe(0);
  });

  it('clamps score into [0, 1] for best tracking', () => {
    const st = createPracticeMilestoneState();
    observePracticeScore(st, 1.5);
    expect(st.bestScore).toBe(1);
    expect(st.firedMatch).toBe(true);
  });

  it('seed adopts score without returning events; blocks retroactive celebrate', () => {
    const st = createPracticeMilestoneState();
    seedPracticeScore(st, 0.9);
    expect(st.bestScore).toBeCloseTo(0.9, 5);
    expect(st.firedClose).toBe(true);
    expect(st.firedMatch).toBe(true);
    expect(observePracticeScore(st, 0.95)).toBeNull();
  });

  it('seed at close leaves match free to fire later', () => {
    const st = createPracticeMilestoneState();
    seedPracticeScore(st, 0.75);
    expect(st.firedClose).toBe(true);
    expect(st.firedMatch).toBe(false);
    expect(observePracticeScore(st, 0.83)?.kind).toBe('match');
  });
});
