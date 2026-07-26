import type { Environment, Season } from './types';

export type SpeedMode = 'pause' | 'live' | 'day' | 'week' | 'month' | 'year';

/** Plant-days advanced per real second for each mode. */
export const SPEED_PLANT_DAYS_PER_SECOND: Record<SpeedMode, number> = {
  pause: 0,
  // ~1 plant-day per 3 real minutes — slow nursery feel
  live: 1 / 180,
  day: 1,
  week: 7,
  month: 30,
  year: 365,
};

export function dayOfYear(agePlantDays: number): number {
  return ((agePlantDays % 365) + 365) % 365;
}

/**
 * Simple temperate seasonal curve for juniper growth flushes.
 * Northern-hemisphere-ish: spring main flush, summer hardening, winter rest.
 */
export function seasonFromDayOfYear(doy: number): Season {
  if (doy < 45 || doy >= 340) return 'dormant';
  if (doy < 90) return 'earlyFlush';
  if (doy < 160) return 'mainFlush';
  if (doy < 250) return 'hardening';
  return 'rest';
}

export function environmentAt(agePlantDays: number): Environment {
  const doy = dayOfYear(agePlantDays);
  const season = seasonFromDayOfYear(doy);
  // Crude light / temp curves
  const solar = 0.55 + 0.45 * Math.sin(((doy - 80) / 365) * Math.PI * 2);
  const temperature = 0.4 + 0.55 * Math.sin(((doy - 70) / 365) * Math.PI * 2);
  return {
    light: Math.max(0.15, Math.min(1, solar)),
    temperature: Math.max(0.1, Math.min(1, temperature)),
    season,
    dayOfYear: doy,
  };
}

export function seasonLabel(season: Season): string {
  switch (season) {
    case 'dormant':
      return 'Dormant';
    case 'earlyFlush':
      return 'Early spring';
    case 'mainFlush':
      return 'Spring flush';
    case 'hardening':
      return 'Hardening';
    case 'rest':
      return 'Late rest';
  }
}

/** Human age phrase for the quiet HUD (not lab "0 d"). */
export function formatAge(days: number): string {
  if (days < 14) return 'Young sapling';
  if (days < 45) return `${Math.floor(days)} days`;
  if (days < 365) {
    const mo = days / 30;
    return mo < 2 ? 'About a month' : `${mo.toFixed(0)} months`;
  }
  const y = days / 365;
  if (y < 1.5) return 'About a year';
  if (y < 10) return `${y.toFixed(1)} years`;
  return `${Math.floor(y)} years`;
}

/** Soft vitality word from reserves (arbitrary units ~0–40+). */
export function vitalityWord(reserves: number): string {
  if (reserves < 6) return 'Low';
  if (reserves < 14) return 'Fair';
  if (reserves < 24) return 'Steady';
  if (reserves < 34) return 'Strong';
  return 'Abundant';
}

/** Bar fill 0–1 from reserves. */
export function vitalityLevel(reserves: number): number {
  return Math.max(0, Math.min(1, reserves / 36));
}
