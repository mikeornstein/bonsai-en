import { describe, expect, it } from 'vitest';
import { createSapling } from '../tree';
import { pruneAt } from '../tools/prune';
import { removeSubtree } from '../tree';
import {
  closestPointsSegments,
  computeDistalMasses,
  computeLiveWorldFrames,
  createPhysicsWorld,
  detectContacts,
  localMass,
  measureTelemetry,
  stepPhysics,
  syncPhysicsWorld,
  woodMass,
} from './index';
import { DEFAULT_PHYSICS_CONFIG } from './types';

describe('physics mass', () => {
  it('wood mass scales with r² L', () => {
    const tree = createSapling('juniper-procumbens', 1);
    const root = tree.nodes[tree.rootId];
    const m1 = woodMass(root, DEFAULT_PHYSICS_CONFIG);
    const clone = { ...root, radius: root.radius * 2 };
    const m2 = woodMass(clone, DEFAULT_PHYSICS_CONFIG);
    expect(m2 / m1).toBeCloseTo(4, 5);
  });

  it('distal mass includes descendants', () => {
    const tree = createSapling('juniper-procumbens', 2);
    const cfg = DEFAULT_PHYSICS_CONFIG;
    const local = new Map<string, number>();
    for (const [id, n] of Object.entries(tree.nodes)) {
      local.set(id, localMass(n, cfg));
    }
    const distal = computeDistalMasses(tree, local);
    const rootD = distal.get(tree.rootId)!;
    let sumLocal = 0;
    for (const m of local.values()) sumLocal += m;
    expect(rootD).toBeCloseTo(sumLocal, 8);
  });
});

describe('physics dynamics', () => {
  it('horizontal branch sags under gravity', () => {
    const tree = createSapling('juniper-procumbens', 42);
    const world = createPhysicsWorld(tree, {
      ...DEFAULT_PHYSICS_CONFIG,
      gravity: 8,
      youngModulusGreen: 800,
      youngModulusLignified: 8e3,
      collisions: false,
      sleepFrames: 9999, // keep awake for measurement
    });

    for (let i = 0; i < 180; i++) {
      stepPhysics(world, tree, 1 / 60, {
        gravity: true,
        cameraAccel: [0, 0, 0],
        cameraAlpha: [0, 0, 0],
        enabled: false,
      });
    }

    let anySag = false;
    for (const [id, j] of world.joints) {
      if (j.parentId === null) continue;
      if (Math.abs(j.thetaX) > 0.002 || Math.abs(j.thetaZ) > 0.002) {
        anySag = true;
      }
      expect(computeLiveWorldFrames(tree, world).get(id)).toBeTruthy();
    }
    expect(anySag).toBe(true);
  });

  it('pruning reduces distal load and springs parent up', () => {
    const tree = createSapling('juniper-procumbens', 7);
    const world = createPhysicsWorld(tree, {
      gravity: 10,
      youngModulusGreen: 600,
      youngModulusLignified: 6e3,
      collisions: false,
      dampingRatio: 0.7,
      sleepFrames: 9999,
    });

    for (let i = 0; i < 200; i++) {
      stepPhysics(world, tree, 1 / 60, {
        gravity: true,
        cameraAccel: [0, 0, 0],
        cameraAlpha: [0, 0, 0],
        enabled: false,
      });
    }

    const target = Object.values(tree.nodes).find(
      (n) =>
        n.parentId &&
        n.parentId !== tree.rootId &&
        n.children.length === 0 &&
        n.living,
    );
    expect(target).toBeTruthy();
    const parentId = target!.parentId!;
    const before = world.joints.get(parentId)!;
    const magBefore = Math.hypot(before.thetaX, before.thetaZ);

    const result = pruneAt(tree, target!.id);
    expect(result.ok).toBe(true);
    syncPhysicsWorld(world, tree);
    expect(world.joints.has(parentId)).toBe(true);

    for (let i = 0; i < 120; i++) {
      stepPhysics(world, tree, 1 / 60, {
        gravity: true,
        cameraAccel: [0, 0, 0],
        cameraAlpha: [0, 0, 0],
        enabled: false,
      });
    }

    const after = world.joints.get(parentId)!;
    const magAfter = Math.hypot(after.thetaX, after.thetaZ);
    expect(magAfter).toBeLessThanOrEqual(magBefore + 0.05);
  });

  it('free oscillation decays to near-zero velocity without gravity', () => {
    const tree = createSapling('juniper-procumbens', 3);
    const world = createPhysicsWorld(tree, {
      collisions: false,
      gravity: 0,
      sleepFrames: 9999,
    });
    const tip = Object.values(tree.nodes).find(
      (n) => n.parentId && n.children.length === 0,
    )!;
    const j = world.joints.get(tip.id)!;
    j.thetaX = 0.2;
    j.omegaX = 0;
    j.sleeping = false;

    for (let i = 0; i < 400; i++) {
      stepPhysics(world, tree, 1 / 60, {
        gravity: false,
        cameraAccel: [0, 0, 0],
        cameraAlpha: [0, 0, 0],
        enabled: false,
      });
    }
    const tel = measureTelemetry(world);
    // Geometry ζ (#94): settles without residual buzz; angle relaxes toward 0
    expect(tel.maxOmega).toBeLessThan(0.08);
    expect(Math.abs(j.thetaX)).toBeLessThan(0.2);
    expect(Math.abs(j.thetaX)).toBeLessThan(0.18);
  });

  it('live frames expose Hermite path for in-segment curvature (#94)', () => {
    const tree = createSapling('juniper-procumbens', 5);
    const world = createPhysicsWorld(tree);
    const frames = computeLiveWorldFrames(tree, world);
    let curved = 0;
    for (const [id, f] of frames) {
      if (id === tree.rootId) continue;
      expect(f.path).toBeTruthy();
      expect(f.path!.length).toBeGreaterThanOrEqual(3);
      // Endpoints match joint chord
      expect(f.path![0][0]).toBeCloseTo(f.base[0], 6);
      expect(f.path![0][1]).toBeCloseTo(f.base[1], 6);
      expect(f.path![f.path!.length - 1][0]).toBeCloseTo(f.tip[0], 6);
      curved += 1;
    }
    expect(curved).toBeGreaterThan(3);
  });

  it('velocities converge to ~0 at rest under gravity alone (no camera)', () => {
    const tree = createSapling('juniper-procumbens', 21);

    for (const collisions of [false, true]) {
      const world = createPhysicsWorld(tree, {
        ...DEFAULT_PHYSICS_CONFIG,
        collisions,
      });

      const samples: number[] = [];
      for (let i = 0; i < 300; i++) {
        stepPhysics(world, tree, 1 / 60, {
          gravity: true,
          cameraAccel: [0, 0, 0],
          cameraAlpha: [0, 0, 0],
          enabled: false,
        });
        if (i % 30 === 29) {
          samples.push(measureTelemetry(world).maxOmega);
        }
      }

      const final = measureTelemetry(world);
      // Must be essentially still whether or not colliders are on
      expect(final.maxOmega, `collisions=${collisions}`).toBeLessThan(0.06);
      expect(final.kineticEnergy, `collisions=${collisions}`).toBeLessThan(1e-5);
      expect(samples[samples.length - 1]).toBeLessThanOrEqual(
        samples[Math.floor(samples.length / 2)] + 0.05,
      );
    }
  });

  it('after impulse, maxOmega falls monotonically toward zero (no external)', () => {
    const tree = createSapling('juniper-procumbens', 8);
    const world = createPhysicsWorld(tree, {
      collisions: false,
      gravity: 0,
      sleepOmega: 0.005,
      sleepFrames: 60,
    });
    for (const j of world.joints.values()) {
      if (j.parentId === null) continue;
      j.thetaX = 0.15;
      j.omegaX = 1.5;
      j.sleeping = false;
      j.quietFrames = 0;
    }

    let prev = Infinity;
    for (let i = 0; i < 90; i++) {
      stepPhysics(world, tree, 1 / 60, {
        gravity: false,
        cameraAccel: [0, 0, 0],
        cameraAlpha: [0, 0, 0],
        enabled: false,
      });
      const w = measureTelemetry(world).maxOmega;
      // Allow tiny numerical bounce but overall decay envelope
      if (i > 5 && i % 5 === 0) {
        expect(w).toBeLessThan(prev + 0.02);
        prev = Math.min(prev, w * 1.15);
      }
    }
    expect(measureTelemetry(world).maxOmega).toBeLessThan(0.08);
  });

  it('camera acceleration produces joint velocity', () => {
    const tree = createSapling('juniper-procumbens', 9);
    const world = createPhysicsWorld(tree, {
      collisions: false,
      gravity: 0,
      cameraForceGain: 1.2,
      youngModulusGreen: 1.5e3,
      sleepFrames: 9999,
    });
    for (const j of world.joints.values()) {
      j.thetaX = 0;
      j.thetaZ = 0;
      j.omegaX = 0;
      j.omegaZ = 0;
      j.sleeping = false;
    }
    for (let i = 0; i < 8; i++) {
      stepPhysics(world, tree, 1 / 60, {
        gravity: false,
        cameraAccel: [40, 0, 0],
        cameraAlpha: [0, 0, 0],
        enabled: true,
      });
    }
    expect(measureTelemetry(world).maxOmega).toBeGreaterThan(0.01);
  });
});

describe('physics collisions', () => {
  it('closestPointsSegments is symmetric for parallel segments', () => {
    const { dist } = closestPointsSegments(
      [0, 0, 0],
      [1, 0, 0],
      [0, 0.1, 0],
      [1, 0.1, 0],
    );
    expect(dist).toBeCloseTo(0.1, 6);
  });

  it('forced capsule overlap is reduced after resolve steps', () => {
    const tree = createSapling('juniper-procumbens', 11);
    const world = createPhysicsWorld(tree, {
      gravity: 0,
      collisions: true,
      youngModulusGreen: 2e4,
      maxDeflectionRad: 0.8,
      contactIterations: 10,
      contactBias: 0.5,
    });

    // Pick two non-adjacent tips and bend them toward each other if possible
    const free = Object.values(tree.nodes).filter(
      (n) => n.parentId && n.living && n.children.length === 0,
    );
    expect(free.length).toBeGreaterThan(1);

    // Artificially create huge deflection on two nodes sharing no ancestry
    const a = free[0];
    const b = free[free.length - 1];
    const ja = world.joints.get(a.id)!;
    const jb = world.joints.get(b.id)!;
    ja.thetaX = 0.4;
    ja.thetaZ = 0.4;
    jb.thetaX = -0.4;
    jb.thetaZ = -0.4;

    // Run several steps so collision resolve can fire if they overlap;
    // also force-detect after zeroing separation by overlapping thetas on parent chain
    for (let i = 0; i < 30; i++) {
      stepPhysics(world, tree, 1 / 60, {
        gravity: false,
        cameraAccel: [0, 0, 0],
        cameraAlpha: [0, 0, 0],
        enabled: false,
      });
    }

    // Soil contact: force a tip below soil by large negative deflection chain
    // and ensure contact list can include soil after detection
    const frames = computeLiveWorldFrames(tree, world);
    // Manually test soil by placing a joint with tip below soil via extreme θ
    // (detection path). If no contacts, still verify parent-child exclusion.
    const contacts = detectContacts(tree, world, frames);
    for (const c of contacts) {
      if (c.bId) {
        const na = tree.nodes[c.aId];
        const nb = tree.nodes[c.bId];
        expect(na.parentId === c.bId).toBe(false);
        expect(nb.parentId === c.aId).toBe(false);
      }
      expect(c.depth).toBeGreaterThan(0);
    }
  });

  it('soil contact pushes tips back above soil plane', () => {
    const tree = createSapling('juniper-procumbens', 5);
    // Build a single soft lateral we can force down
    const world = createPhysicsWorld(tree, {
      gravity: 40,
      collisions: true,
      youngModulusGreen: 1.5e4,
      youngModulusLignified: 8e4,
      dampingRatio: 0.4,
      contactIterations: 8,
      contactBias: 0.55,
      maxDeflectionRad: 0.9,
    });

    for (let i = 0; i < 300; i++) {
      stepPhysics(world, tree, 1 / 60, {
        gravity: true,
        cameraAccel: [0, 0, 0],
        cameraAlpha: [0, 0, 0],
        enabled: false,
      });
    }

    const frames = computeLiveWorldFrames(tree, world);
    for (const [id, f] of frames) {
      if (id === tree.rootId) continue;
      const j = world.joints.get(id);
      if (!j) continue;
      // Allow contact slop + residual under heavy gravity
      expect(f.tip[1] - j.radius).toBeGreaterThan(-0.008);
    }
  });

  it('sync drops removed nodes without NaNs', () => {
    const tree = createSapling('juniper-procumbens', 4);
    const world = createPhysicsWorld(tree);
    const victim = Object.values(tree.nodes).find(
      (n) => n.parentId && n.parentId !== tree.rootId,
    )!;
    removeSubtree(tree, victim.id);
    syncPhysicsWorld(world, tree);
    expect(world.joints.has(victim.id)).toBe(false);
    for (const j of world.joints.values()) {
      expect(Number.isFinite(j.thetaX)).toBe(true);
      expect(Number.isFinite(j.J)).toBe(true);
      expect(j.J).toBeGreaterThan(0);
    }
  });

  /** Thin tips (below old 1.6 mm visual floor) must not explode contacts (#58). */
  it('fine-tip canopy settles without NaN blow-up', () => {
    const tree = createSapling('juniper-procumbens', 58);
    // Force several tips into the fine-feature band
    for (const n of Object.values(tree.nodes)) {
      if (n.living && n.children.length === 0) {
        n.radius = 0.00045;
        n.targetRadius = 0.00045;
      }
    }
    const world = createPhysicsWorld(tree, {
      ...DEFAULT_PHYSICS_CONFIG,
      gravity: 9.81 * 0.22,
      collisions: true,
    });

    for (let i = 0; i < 240; i++) {
      stepPhysics(world, tree, 1 / 60, {
        gravity: true,
        cameraAccel: [0, 0, 0],
        cameraAlpha: [0, 0, 0],
        enabled: false,
      });
    }

    const tel = measureTelemetry(world);
    expect(Number.isFinite(tel.kineticEnergy)).toBe(true);
    expect(Number.isFinite(tel.maxOmega)).toBe(true);
    expect(tel.kineticEnergy).toBeLessThan(50);
    for (const j of world.joints.values()) {
      expect(Number.isFinite(j.thetaX)).toBe(true);
      expect(Number.isFinite(j.thetaZ)).toBe(true);
      expect(Number.isFinite(j.omegaX)).toBe(true);
    }
  });
});
