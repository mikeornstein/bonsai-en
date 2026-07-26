import { describe, expect, it } from 'vitest';
import {
  environmentAt,
  isRestSeason,
  seasonFromDayOfYear,
  vitalityBarColor,
  vitalityWord,
} from './time';

describe('vitalityWord', () => {
  it('labels low reserves as Low in growth seasons', () => {
    expect(vitalityWord(3)).toBe('Low');
    expect(vitalityWord(3, 'mainFlush')).toBe('Low');
    expect(vitalityWord(3, 'earlyFlush')).toBe('Low');
    expect(vitalityWord(3, 'hardening')).toBe('Low');
  });

  it('labels low reserves as Resting in dormant / late rest', () => {
    expect(vitalityWord(3, 'dormant')).toBe('Resting');
    expect(vitalityWord(5.5, 'rest')).toBe('Resting');
  });

  it('uses Quiet sap for fair-band reserves in rest seasons', () => {
    expect(vitalityWord(10, 'dormant')).toBe('Quiet sap');
    expect(vitalityWord(10, 'rest')).toBe('Quiet sap');
    expect(vitalityWord(10, 'mainFlush')).toBe('Fair');
  });

  it('keeps higher bands season-agnostic', () => {
    expect(vitalityWord(20, 'dormant')).toBe('Steady');
    expect(vitalityWord(30, 'rest')).toBe('Strong');
    expect(vitalityWord(40, 'mainFlush')).toBe('Abundant');
  });
});

describe('vitalityBarColor', () => {
  it('avoids danger red during seasonal rest', () => {
    const restColor = vitalityBarColor(3, 'dormant');
    const stressColor = vitalityBarColor(3, 'mainFlush');
    expect(restColor).not.toBe('var(--danger)');
    expect(stressColor).toBe('var(--danger)');
  });
});

describe('isRestSeason', () => {
  it('flags dormant and rest only', () => {
    expect(isRestSeason('dormant')).toBe(true);
    expect(isRestSeason('rest')).toBe(true);
    expect(isRestSeason('mainFlush')).toBe(false);
    expect(isRestSeason(undefined)).toBe(false);
  });
});

describe('seasonFromDayOfYear', () => {
  it('maps late year into dormant', () => {
    expect(seasonFromDayOfYear(350)).toBe('dormant');
    expect(seasonFromDayOfYear(10)).toBe('dormant');
    expect(environmentAt(360).season).toBe('dormant');
  });
});
