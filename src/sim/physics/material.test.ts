import { describe, expect, it } from 'vitest';
import type { Internode } from '../types';
import {
  bendDamping,
  bendStiffness,
  dampingRatioFor,
  lignifyBlend,
  sectionInertia,
  youngModulus,
} from './material';
import { DEFAULT_PHYSICS_CONFIG } from './types';

function fakeNode(
  partial: Partial<Internode> & Pick<Internode, 'radius' | 'length'>,
): Internode {
  return {
    id: 'n-test',
    parentId: 'n-parent',
    children: [],
    targetLength: partial.length,
    targetRadius: partial.radius,
    orientation: [0, 0, 0, 1],
    ageDays: 10,
    lignification: 0.2,
    living: true,
    buds: [],
    foliage: [],
    wound: 0,
    ...partial,
  };
}

describe('beam stiffness geometry (#94)', () => {
  const cfg = DEFAULT_PHYSICS_CONFIG;

  it('section inertia scales as r⁴', () => {
    const i1 = sectionInertia(0.01);
    const i2 = sectionInertia(0.02);
    expect(i2 / i1).toBeCloseTo(16, 5);
  });

  it('k scales as r⁴ (same L, lignify)', () => {
    const a = fakeNode({ radius: 0.004, length: 0.01, lignification: 0.4 });
    const b = fakeNode({ radius: 0.008, length: 0.01, lignification: 0.4 });
    const ka = bendStiffness(a, cfg);
    const kb = bendStiffness(b, cfg);
    expect(kb / ka).toBeCloseTo(16, 4);
  });

  it('k scales as 1/L (same r, lignify)', () => {
    const short = fakeNode({ radius: 0.005, length: 0.008, lignification: 0.5 });
    const long = fakeNode({ radius: 0.005, length: 0.016, lignification: 0.5 });
    const ks = bendStiffness(short, cfg);
    const kl = bendStiffness(long, cfg);
    expect(ks / kl).toBeCloseTo(2, 4);
  });

  it('lignified wood is stiffer than green at same geometry', () => {
    const green = fakeNode({
      radius: 0.006,
      length: 0.01,
      lignification: 0.05,
    });
    const hard = fakeNode({
      radius: 0.006,
      length: 0.01,
      lignification: 0.95,
    });
    expect(bendStiffness(hard, cfg)).toBeGreaterThan(
      bendStiffness(green, cfg) * 5,
    );
    expect(youngModulus(0.95, cfg)).toBeGreaterThan(
      youngModulus(0.05, cfg) * 5,
    );
  });

  it('wire multiplies stiffness', () => {
    const bare = fakeNode({ radius: 0.004, length: 0.01, lignification: 0.3 });
    const wired = fakeNode({
      radius: 0.004,
      length: 0.01,
      lignification: 0.3,
      wire: {
        setAmount: 0.5,
        targetOrientation: [0, 0, 0, 1],
        installOrientation: [0, 0, 0, 1],
        installedPlantDay: 0,
        tension: 1,
      },
    });
    expect(bendStiffness(wired, cfg)).toBeGreaterThan(
      bendStiffness(bare, cfg) * 5,
    );
  });
});

describe('geometry damping (#94)', () => {
  const cfg = DEFAULT_PHYSICS_CONFIG;

  it('lignify blend is smoothstep', () => {
    expect(lignifyBlend(0)).toBe(0);
    expect(lignifyBlend(1)).toBe(1);
    expect(lignifyBlend(0.5)).toBeCloseTo(0.5, 5);
  });

  it('green wood has higher ζ than lignified at same radius', () => {
    const zG = dampingRatioFor(0.05, 0.008, cfg);
    const zH = dampingRatioFor(0.95, 0.008, cfg);
    expect(zG).toBeGreaterThan(zH);
    // Not the old sludge regime
    expect(zG).toBeLessThan(20);
    expect(zH).toBeLessThan(5);
  });

  it('thin tips get extra damping vs thick wood', () => {
    const tip = dampingRatioFor(0.3, 0.001, cfg);
    const thick = dampingRatioFor(0.3, 0.012, cfg);
    expect(tip).toBeGreaterThan(thick);
  });

  it('c = 2 ζ √(k J) uses geometry ζ', () => {
    const node = fakeNode({ radius: 0.003, length: 0.01, lignification: 0.2 });
    const k = bendStiffness(node, cfg);
    const J = 1e-4;
    const c = bendDamping(k, J, node, cfg);
    const z = dampingRatioFor(node.lignification, node.radius, cfg);
    expect(c).toBeCloseTo(2 * z * Math.sqrt(k * J), 6);
  });
});
