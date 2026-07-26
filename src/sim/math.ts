import type { Quat, Vec3 } from './types';

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function quatIdentity(): Quat {
  return [0, 0, 0, 1];
}

export function quatCopy(q: Quat): Quat {
  return [q[0], q[1], q[2], q[3]];
}

export function quatNormalize(q: Quat): Quat {
  const len = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}

export function quatMultiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** Rotate vector by quaternion. */
export function quatRotateVec3(q: Quat, v: Vec3): Vec3 {
  const [x, y, z] = v;
  const [qx, qy, qz, qw] = q;
  const ix = qw * x + qy * z - qz * y;
  const iy = qw * y + qz * x - qx * z;
  const iz = qw * z + qx * y - qy * x;
  const iw = -qx * x - qy * y - qz * z;
  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx,
  ];
}

export function quatFromAxisAngle(axis: Vec3, angle: number): Quat {
  const [x, y, z] = normalize(axis);
  const half = angle * 0.5;
  const s = Math.sin(half);
  return quatNormalize([x * s, y * s, z * s, Math.cos(half)]);
}

/** Quaternion that rotates `from` unit vector onto `to` unit vector. */
export function quatFromUnitToUnit(from: Vec3, to: Vec3): Quat {
  const f = normalize(from);
  const t = normalize(to);
  const d = dot(f, t);
  if (d > 0.999999) return quatIdentity();
  if (d < -0.999999) {
    let axis: Vec3 = cross(f, [1, 0, 0]);
    if (length(axis) < 1e-6) axis = cross(f, [0, 1, 0]);
    return quatFromAxisAngle(normalize(axis), Math.PI);
  }
  const c = cross(f, t);
  const q: Quat = [c[0], c[1], c[2], 1 + d];
  return quatNormalize(q);
}

export function quatSlerp(a: Quat, b: Quat, t: number): Quat {
  let [ax, ay, az, aw] = a;
  let [bx, by, bz, bw] = b;
  let cosHalf = ax * bx + ay * by + az * bz + aw * bw;
  if (cosHalf < 0) {
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
    cosHalf = -cosHalf;
  }
  if (cosHalf >= 0.9995) {
    return quatNormalize([
      lerp(ax, bx, t),
      lerp(ay, by, t),
      lerp(az, bz, t),
      lerp(aw, bw, t),
    ]);
  }
  const half = Math.acos(clamp(cosHalf, -1, 1));
  const sinHalf = Math.sin(half);
  const ra = Math.sin((1 - t) * half) / sinHalf;
  const rb = Math.sin(t * half) / sinHalf;
  return [ax * ra + bx * rb, ay * ra + by * rb, az * ra + bz * rb, aw * ra + bw * rb];
}

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return [x, y, z];
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function length(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function normalize(a: Vec3): Vec3 {
  const len = length(a) || 1;
  return [a[0] / len, a[1] / len, a[2] / len];
}

/** Mulberry32 — small seeded PRNG. */
export function createRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randRange(rng: () => number, lo: number, hi: number): number {
  return lo + (hi - lo) * rng();
}

export function randNormal(rng: () => number, mean = 0, std = 1): number {
  // Box-Muller
  const u = Math.max(1e-9, rng());
  const v = rng();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return mean + z * std;
}
