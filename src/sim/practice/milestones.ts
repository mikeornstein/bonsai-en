/**
 * Session practice-grade milestones (pure TS, no Three.js).
 *
 * Fires a one-time quiet acknowledgment when the player's *best score so far*
 * first crosses close / match. Oscillation around the boundary cannot re-fire.
 */
import { PRACTICE_GRADE_THRESHOLDS } from './score';

export type PracticeMilestoneKind = 'close' | 'match';

export interface PracticeMilestoneState {
  /** Highest practice score observed this session. */
  bestScore: number;
  firedClose: boolean;
  firedMatch: boolean;
}

export interface PracticeMilestoneEvent {
  kind: PracticeMilestoneKind;
  /** Soft status line copy — zen room tone, no confetti. */
  message: string;
}

/** Quiet status lines when first reaching each grade band. */
export const PRACTICE_MILESTONE_COPY: Record<PracticeMilestoneKind, string> = {
  close: 'Close · silhouette settling',
  match: 'Match · rest and read',
};

export function createPracticeMilestoneState(): PracticeMilestoneState {
  return {
    bestScore: 0,
    firedClose: false,
    firedMatch: false,
  };
}

/** Clear session milestones (new sapling / fresh tree). */
export function resetPracticeMilestones(state: PracticeMilestoneState): void {
  state.bestScore = 0;
  state.firedClose = false;
  state.firedMatch = false;
}

/**
 * Quietly adopt a current score as the session baseline (boot / mode toggle /
 * new sapling). Updates best-so-far and marks already-crossed thresholds as
 * fired so restored trees do not retroactively celebrate.
 */
export function seedPracticeScore(
  state: PracticeMilestoneState,
  score: number,
): void {
  if (!Number.isFinite(score)) return;
  const s = Math.max(0, Math.min(1, score));
  if (s > state.bestScore) state.bestScore = s;
  const best = state.bestScore;
  if (best >= PRACTICE_GRADE_THRESHOLDS.match) {
    state.firedMatch = true;
    state.firedClose = true;
  } else if (best >= PRACTICE_GRADE_THRESHOLDS.close) {
    state.firedClose = true;
  }
}

/**
 * Observe a new practice score. Updates best-so-far; returns at most one
 * milestone event per call. Uses best score (not instantaneous grade) so
 * flicker at the threshold cannot spam celebrations.
 *
 * If both close and match are newly crossed in one tick (jump over close),
 * only `match` is returned and both flags are set — the higher beat stands.
 */
export function observePracticeScore(
  state: PracticeMilestoneState,
  score: number,
): PracticeMilestoneEvent | null {
  if (!Number.isFinite(score)) return null;
  const s = Math.max(0, Math.min(1, score));
  if (s > state.bestScore) {
    state.bestScore = s;
  }

  const best = state.bestScore;
  const closeAt = PRACTICE_GRADE_THRESHOLDS.close;
  const matchAt = PRACTICE_GRADE_THRESHOLDS.match;

  // Higher milestone first so a single jump to match does not flash "close"
  // after the player has already surpassed it.
  if (!state.firedMatch && best >= matchAt) {
    state.firedMatch = true;
    state.firedClose = true;
    return {
      kind: 'match',
      message: PRACTICE_MILESTONE_COPY.match,
    };
  }
  if (!state.firedClose && best >= closeAt) {
    state.firedClose = true;
    return {
      kind: 'close',
      message: PRACTICE_MILESTONE_COPY.close,
    };
  }
  return null;
}
