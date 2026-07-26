import { describe, expect, it } from 'vitest';
import {
  BEND_DAMPING,
  BEND_DEG_PER_PIXEL,
  BEND_MAX_DEG_PER_EVENT,
  bendDirFromViewDelta,
  dampedBendRadians,
  wireSetLabel,
} from './wire';

describe('dampedBendRadians', () => {
  it('documents ~deg-per-pixel feel before damping', () => {
    // Raw (undamped) magnitude for 100px = 28° at BEND_DEG_PER_PIXEL
    expect(BEND_DEG_PER_PIXEL * 100).toBeCloseTo(28, 5);
  });

  it('scales with pixel travel and applies damping', () => {
    const { yaw, pitch } = dampedBendRadians(100, 0);
    const expectedDeg = 100 * BEND_DEG_PER_PIXEL * BEND_DAMPING;
    // 100px * 0.28 * 0.55 = 15.4°, but capped at max — so use min
    const capped = Math.min(expectedDeg, BEND_MAX_DEG_PER_EVENT);
    expect((yaw * 180) / Math.PI).toBeCloseTo(capped, 5);
    expect(pitch).toBeCloseTo(0, 8);
  });

  it('maps drag-down to positive pitch (tip toward −cameraUp)', () => {
    const { pitch } = dampedBendRadians(0, 40);
    expect(pitch).toBeGreaterThan(0);
  });

  it('caps extreme flicks per event', () => {
    const { yaw } = dampedBendRadians(10_000, 0);
    const deg = (Math.abs(yaw) * 180) / Math.PI;
    expect(deg).toBeLessThanOrEqual(BEND_MAX_DEG_PER_EVENT + 1e-9);
  });

  it('is antisymmetric in dx', () => {
    const a = dampedBendRadians(20, 0);
    const b = dampedBendRadians(-20, 0);
    expect(a.yaw).toBeCloseTo(-b.yaw, 8);
  });
});

describe('bendDirFromViewDelta', () => {
  const right: [number, number, number] = [1, 0, 0];
  const up: [number, number, number] = [0, 1, 0];
  const forward: [number, number, number] = [0, 0, 1];

  it('keeps length ~1 and stays near original for tiny moves', () => {
    const out = bendDirFromViewDelta(forward, right, up, 0.5, 0);
    const len = Math.hypot(out[0], out[1], out[2]);
    expect(len).toBeCloseTo(1, 5);
    // Small yaw around up → mostly still +Z with a bit of +X
    expect(out[2]).toBeGreaterThan(0.99);
    expect(out[0]).toBeGreaterThan(0);
  });

  it('drag right yaws around camera up (toward +X when looking +Z)', () => {
    const out = bendDirFromViewDelta(forward, right, up, 50, 0);
    expect(out[0]).toBeGreaterThan(0.05);
    expect(out[2]).toBeGreaterThan(0.5);
  });

  it('drag down pitches tip down (toward -Y)', () => {
    const out = bendDirFromViewDelta(forward, right, up, 0, 50);
    expect(out[1]).toBeLessThan(-0.05);
  });

  it('zero delta returns original direction (normalized)', () => {
    const out = bendDirFromViewDelta([0, 2, 0], right, up, 0, 0);
    expect(out[0]).toBeCloseTo(0, 6);
    expect(out[1]).toBeCloseTo(1, 6);
    expect(out[2]).toBeCloseTo(0, 6);
  });
});

describe('wireSetLabel', () => {
  it('labels fresh / wiring / set bands with percent', () => {
    expect(wireSetLabel(0)).toMatch(/fresh wire · 0%/);
    expect(wireSetLabel(0.4)).toMatch(/wiring · 40% set/);
    expect(wireSetLabel(0.9)).toMatch(/wire set \(90%\)/);
  });
});
