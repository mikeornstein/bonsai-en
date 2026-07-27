import * as THREE from 'three';

/** Deterministic 2D value noise (not cryptographically anything). */
function hash2(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function smoothNoise(x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0);
  const b = hash2(x0 + 1, y0);
  const c = hash2(x0, y0 + 1);
  const d = hash2(x0 + 1, y0 + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, y: number, octaves = 4): number {
  let v = 0;
  let a = 0.5;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    v += a * smoothNoise(x * f, y * f);
    f *= 2;
    a *= 0.5;
  }
  return v;
}

function canvasTexture(
  size: number,
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
  opts?: { wrap?: THREE.Wrapping; colorSpace?: THREE.ColorSpace },
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = opts?.wrap ?? THREE.RepeatWrapping;
  tex.colorSpace = opts?.colorSpace ?? THREE.NoColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/** Vertical bark grain albedo — juniper plates, fissures, lichen (sRGB). */
export function createBarkAlbedoTexture(): THREE.CanvasTexture {
  return canvasTexture(
    512,
    (ctx, size) => {
      const img = ctx.createImageData(size, size);
      const d = img.data;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const u = x / size;
          const v = y / size;
          const grain = fbm(u * 7, v * 36, 4);
          const plate = fbm(u * 4.2, v * 2.5, 3);
          const micro = fbm(u * 28, v * 10, 2);
          const crackWave = Math.sin(u * Math.PI * 10 + plate * 5 + grain);
          const crack = Math.abs(crackWave) < 0.055 ? 0.35 : 0;
          const ridge = fbm(u * 18, v * 5, 2);

          let r = 78 + grain * 48 + ridge * 18 + micro * 10;
          let g = 52 + grain * 28 + ridge * 10 + micro * 6;
          let b = 36 + grain * 16 + ridge * 6 + micro * 4;

          r -= crack * 55 + (1 - plate) * 22;
          g -= crack * 40 + (1 - plate) * 16;
          b -= crack * 28 + (1 - plate) * 12;

          if (plate > 0.62 && crack < 0.1) {
            r += 14;
            g += 8;
            b += 4;
          }

          if (fbm(u * 18, v * 18, 2) > 0.74) {
            r = r * 0.72 + 48;
            g = g * 0.68 + 62;
            b = b * 0.68 + 36;
          }

          const i = (y * size + x) * 4;
          d[i] = Math.max(0, Math.min(255, r));
          d[i + 1] = Math.max(0, Math.min(255, g));
          d[i + 2] = Math.max(0, Math.min(255, b));
          d[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    },
    { colorSpace: THREE.SRGBColorSpace },
  );
}

/** Height-derived normal map for bark. */
export function createBarkNormalTexture(): THREE.CanvasTexture {
  const size = 512;
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const grain = fbm(u * 7, v * 36, 4);
      const plate = fbm(u * 4.2, v * 2.5, 3);
      const crackWave = Math.sin(u * Math.PI * 10 + plate * 5 + grain);
      const crack = Math.abs(crackWave) < 0.055 ? 0.5 : 0;
      const micro = fbm(u * 28, v * 10, 2);
      height[y * size + x] = grain * 0.65 + plate * 0.28 + micro * 0.12 - crack;
    }
  }

  return canvasTexture(size, (ctx, s) => {
    const img = ctx.createImageData(s, s);
    const d = img.data;
    const strength = 3.4;
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const xl = height[y * s + ((x - 1 + s) % s)];
        const xr = height[y * s + ((x + 1) % s)];
        const yu = height[((y - 1 + s) % s) * s + x];
        const yd = height[((y + 1) % s) * s + x];
        let nx = (xl - xr) * strength;
        let ny = (yu - yd) * strength;
        let nz = 1;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len;
        ny /= len;
        nz /= len;
        const i = (y * s + x) * 4;
        d[i] = (nx * 0.5 + 0.5) * 255;
        d[i + 1] = (ny * 0.5 + 0.5) * 255;
        d[i + 2] = (nz * 0.5 + 0.5) * 255;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
}

export function createBarkRoughnessTexture(): THREE.CanvasTexture {
  return canvasTexture(256, (ctx, size) => {
    const img = ctx.createImageData(size, size);
    const d = img.data;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const v = y / size;
        const g = fbm(u * 8, v * 22, 3);
        const plate = fbm(u * 4, v * 2.5, 2);
        const r = 0.62 + g * 0.32 - plate * 0.08;
        const c = Math.floor(Math.min(1, Math.max(0, r)) * 255);
        const i = (y * size + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = c;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
}

/**
 * Soft juniper scale albedo with edge alpha.
 * Higher res for close-up photoreal pads.
 */
export function createFoliageAlbedoTexture(
  base: [number, number, number],
): THREE.CanvasTexture {
  return canvasTexture(
    128,
    (ctx, size) => {
      const [br, bg, bb] = base;
      const img = ctx.createImageData(size, size);
      const d = img.data;
      const cx = size * 0.5;
      const cy = size * 0.55;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const nx = (x - cx) / (size * 0.36);
          const ny = (y - cy) / (size * 0.48);
          const taper = 1 + Math.max(0, -ny) * 0.45;
          const r2 = nx * nx * taper + ny * ny;
          const edge = Math.max(0, 1 - r2);
          // Softer alpha falloff so pad silhouettes don't read as cardboard cutouts
          const alpha =
            edge > 0.008 ? Math.min(1, Math.pow(edge, 0.72) * 1.22) : 0;
          const vein = 1 - Math.abs(nx) * 0.35;
          const n = fbm(x * 0.08, y * 0.08, 2);
          const mid = 1 + (1 - Math.abs(nx) * 2.2) * 0.08 * Math.max(0, edge);
          const i = (y * size + x) * 4;
          d[i] = Math.min(255, br * vein * mid * (0.86 + n * 0.2));
          d[i + 1] = Math.min(255, bg * vein * mid * (0.86 + n * 0.24));
          d[i + 2] = Math.min(255, bb * vein * mid * (0.86 + n * 0.16));
          d[i + 3] = Math.floor(alpha * 255);
        }
      }
      ctx.putImageData(img, 0, 0);
    },
    { wrap: THREE.ClampToEdgeWrapping, colorSpace: THREE.SRGBColorSpace },
  );
}

/** Akadama / pumice mix — cooler gray-brown grit field. */
export function createSoilAlbedoTexture(): THREE.CanvasTexture {
  return canvasTexture(
    256,
    (ctx, size) => {
      const img = ctx.createImageData(size, size);
      const d = img.data;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const u = x / size;
          const v = y / size;
          const n = fbm(u * 16, v * 16, 5);
          const pebble = fbm(u * 48, v * 48, 3);
          const grain = fbm(u * 90, v * 90, 2);
          // Cooler gray-brown akadama / pumice mix
          let r = 78 + n * 42 + grain * 12;
          let g = 64 + n * 32 + grain * 10;
          let b = 48 + n * 22 + grain * 8;
          if (pebble > 0.62) {
            // Warm clay granules
            r += 36;
            g += 26;
            b += 14;
          }
          if (pebble > 0.78) {
            // Lighter pumice chips
            r = 155 + n * 20;
            g = 140 + n * 18;
            b = 120 + n * 14;
          }
          // Dark basalt grit flecks
          if (hash2(x * 0.31, y * 0.29) > 0.93) {
            r = 55;
            g = 52;
            b = 48;
          }
          // Pale quartz flecks
          if (hash2(x * 0.71, y * 0.53) > 0.955) {
            r = 175;
            g = 168;
            b = 155;
          }
          // Tiny moss hint (rare)
          if (hash2(x * 0.19, y * 0.41) > 0.978) {
            r = r * 0.55 + 40;
            g = g * 0.5 + 70;
            b = b * 0.55 + 28;
          }
          const i = (y * size + x) * 4;
          d[i] = Math.min(255, r);
          d[i + 1] = Math.min(255, g);
          d[i + 2] = Math.min(255, b);
          d[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    },
    { colorSpace: THREE.SRGBColorSpace },
  );
}

/** Height-derived normal for soil grit (tangent space). */
export function createSoilNormalTexture(): THREE.CanvasTexture {
  const size = 256;
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const n = fbm(u * 16, v * 16, 4);
      const pebble = fbm(u * 48, v * 48, 3);
      height[y * size + x] = n * 0.55 + pebble * 0.45;
    }
  }
  return canvasTexture(size, (ctx, s) => {
    const img = ctx.createImageData(s, s);
    const d = img.data;
    const strength = 3.4;
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const xl = height[y * s + ((x - 1 + s) % s)];
        const xr = height[y * s + ((x + 1) % s)];
        const yu = height[((y - 1 + s) % s) * s + x];
        const yd = height[((y + 1) % s) * s + x];
        let nx = (xl - xr) * strength;
        let ny = (yu - yd) * strength;
        let nz = 1;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len;
        ny /= len;
        nz /= len;
        const i = (y * s + x) * 4;
        d[i] = (nx * 0.5 + 0.5) * 255;
        d[i + 1] = (ny * 0.5 + 0.5) * 255;
        d[i + 2] = (nz * 0.5 + 0.5) * 255;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
}

/**
 * Soft matte-to-semi-glaze ceramic albedo.
 * Warm unglazed clay body with subtle kiln variation (not plastic red).
 */
export function createPotAlbedoTexture(): THREE.CanvasTexture {
  return canvasTexture(
    256,
    (ctx, size) => {
      const img = ctx.createImageData(size, size);
      const d = img.data;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const u = x / size;
          const v = y / size;
          const n = fbm(u * 5, v * 7, 4);
          const fine = fbm(u * 40, v * 40, 2);
          const kiln = fbm(u * 2.2, v * 3.1, 3);
          // Muted iron-oxide ceramic — warm brown-gray
          let r = 118 + n * 28 + fine * 8 + kiln * 12;
          let g = 78 + n * 18 + fine * 5 + kiln * 6;
          let b = 58 + n * 12 + fine * 4 + kiln * 4;
          // Soft vertical throwing marks
          const throwMark = Math.sin(v * Math.PI * 22 + n * 2) * 0.5 + 0.5;
          r -= throwMark * 6;
          g -= throwMark * 4;
          b -= throwMark * 3;
          // Slight rim darkening (v near top/bottom of UV cylinder)
          const edge = Math.pow(Math.abs(v - 0.5) * 2, 2);
          r -= edge * 10;
          g -= edge * 8;
          b -= edge * 6;
          const i = (y * size + x) * 4;
          d[i] = Math.min(255, Math.max(0, r));
          d[i + 1] = Math.min(255, Math.max(0, g));
          d[i + 2] = Math.min(255, Math.max(0, b));
          d[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    },
    { colorSpace: THREE.SRGBColorSpace },
  );
}

/** Ceramic roughness — glossier mid-body, matte near foot/rim. */
export function createPotRoughnessTexture(): THREE.CanvasTexture {
  return canvasTexture(256, (ctx, size) => {
    const img = ctx.createImageData(size, size);
    const d = img.data;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const v = y / size;
        const n = fbm(u * 8, v * 10, 3);
        // Soft semi-glaze: mid roughness with micro variation
        let r = 0.42 + n * 0.22;
        // Foot / rim slightly more matte
        const edge = Math.pow(Math.abs(v - 0.5) * 2, 1.6);
        r += edge * 0.18;
        const c = Math.floor(Math.min(1, Math.max(0, r)) * 255);
        const i = (y * size + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = c;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
}

/** Subtle ceramic surface normal (throwing + kiln pits). */
export function createPotNormalTexture(): THREE.CanvasTexture {
  const size = 256;
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const throwMark = Math.sin(v * Math.PI * 22) * 0.08;
      const n = fbm(u * 12, v * 16, 3) * 0.25;
      const pits = fbm(u * 50, v * 50, 2) > 0.72 ? 0.12 : 0;
      height[y * size + x] = throwMark + n - pits;
    }
  }
  return canvasTexture(size, (ctx, s) => {
    const img = ctx.createImageData(s, s);
    const d = img.data;
    const strength = 1.6;
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const xl = height[y * s + ((x - 1 + s) % s)];
        const xr = height[y * s + ((x + 1) % s)];
        const yu = height[((y - 1 + s) % s) * s + x];
        const yd = height[((y + 1) % s) * s + x];
        let nx = (xl - xr) * strength;
        let ny = (yu - yd) * strength;
        let nz = 1;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len;
        ny /= len;
        nz /= len;
        const i = (y * s + x) * 4;
        d[i] = (nx * 0.5 + 0.5) * 255;
        d[i + 1] = (ny * 0.5 + 0.5) * 255;
        d[i + 2] = (nz * 0.5 + 0.5) * 255;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
}

/**
 * Soft zen-tinted cyclorama — cool overcast sky into warm stone floor.
 * Visible background only; IBL comes from the zen-garden equirect.
 */
export function createStudioBackgroundTexture(): THREE.CanvasTexture {
  return canvasTexture(
    8,
    (ctx, size) => {
      const g = ctx.createLinearGradient(0, 0, 0, size);
      // Top: soft cool overcast (matches zen HDRI sky)
      g.addColorStop(0, '#e8edf0');
      // Mid: warm linen / paper with a hint of garden green
      g.addColorStop(0.4, '#e2e0d6');
      // Lower: soft stone / gravel
      g.addColorStop(0.76, '#cfc8bc');
      g.addColorStop(1, '#bfb6aa');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
    },
    { wrap: THREE.ClampToEdgeWrapping, colorSpace: THREE.SRGBColorSpace },
  );
}

/**
 * Zen-garden equirect for PMREM IBL — soft daylight, greenery, gravel, water.
 * Muted and low-contrast so reflections feel real without competing with the tree.
 * Low-res by design; fromEquirectangular is far cheaper than RoomEnvironment.
 */
export function createZenGardenEnvEquirectTexture(): THREE.CanvasTexture {
  // 256 is enough for soft IBL and much cheaper on SwiftShader PMREM
  return canvasTexture(
    256,
    (ctx, size) => {
      const img = ctx.createImageData(size, size);
      const d = img.data;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const elev = y / size; // 0 top = +Y
          const u = x / size;

          // --- Soft overcast sky (cool zenith → warmer haze) ---
          let r = 196 + elev * 22;
          let g = 204 + elev * 12;
          let b = 214 - elev * 8;

          // Soft sun disk (warm key) upper-right — ceramic highlights
          const lx = (u - 0.68) * 2.4;
          const ly = (elev - 0.18) * 2.8;
          const key = Math.exp(-(lx * lx + ly * ly) * 3.2);
          r += key * 95;
          g += key * 78;
          b += key * 48;

          // Cool fill opposite sun
          const fill =
            Math.exp(-(((u - 0.18) * 2.6) ** 2) - (((elev - 0.32) * 2.1) ** 2)) *
            28;
          r += fill * 0.55;
          g += fill * 0.75;
          b += fill * 1.05;

          // --- Horizon: soft bamboo / garden greenery ---
          const foliageBand =
            smoothstep(0.4, 0.48, elev) * smoothstep(0.62, 0.52, elev);
          const bamboo = Math.pow(
            Math.abs(Math.sin(u * Math.PI * 14 + Math.sin(u * 9) * 0.4)),
            8,
          );
          // Cheap 2-octave noise (avoid full fbm every pixel)
          const canopy = smoothNoise(u * 6, elev * 10) * 0.65 +
            smoothNoise(u * 12, elev * 20) * 0.35;
          const greenMix = foliageBand * (0.35 + canopy * 0.55 + bamboo * 0.25);
          r = r * (1 - greenMix * 0.55) + (72 + canopy * 40) * greenMix;
          g = g * (1 - greenMix * 0.4) + (98 + canopy * 36) * greenMix;
          b = b * (1 - greenMix * 0.65) + (58 + canopy * 22) * greenMix;

          // Soft stone wall under greenery
          const wall =
            smoothstep(0.52, 0.58, elev) * smoothstep(0.68, 0.6, elev);
          const stone = smoothNoise(u * 10, elev * 4);
          r = r * (1 - wall * 0.5) + (150 + stone * 28) * wall;
          g = g * (1 - wall * 0.5) + (142 + stone * 24) * wall;
          b = b * (1 - wall * 0.5) + (128 + stone * 18) * wall;

          // Quiet water ring (cool dark, for glaze reflections)
          const water =
            smoothstep(0.56, 0.62, elev) * smoothstep(0.72, 0.66, elev);
          const ripple = smoothNoise(u * 18, elev * 8);
          r = r * (1 - water * 0.55) + (88 + ripple * 18) * water;
          g = g * (1 - water * 0.55) + (102 + ripple * 16) * water;
          b = b * (1 - water * 0.45) + (108 + ripple * 20) * water;

          // Raked gravel floor (bottom hemisphere)
          const ground = smoothstep(0.62, 0.78, elev);
          const gravel = smoothNoise(u * 14, elev * 18);
          const rake = Math.sin((elev - 0.7) * 90 + gravel * 2.5) * 0.5 + 0.5;
          const gr = 168 + gravel * 36 + rake * 10;
          const gg = 156 + gravel * 28 + rake * 8;
          const gb = 132 + gravel * 20 + rake * 6;
          r = r * (1 - ground) + gr * ground;
          g = g * (1 - ground) + gg * ground;
          b = b * (1 - ground) + gb * ground;

          // Mute so IBL stays gentle — bonsai remains the hero
          r *= 0.88;
          g *= 0.88;
          b *= 0.88;

          const i = (y * size + x) * 4;
          d[i] = Math.min(255, Math.max(0, r));
          d[i + 1] = Math.min(255, Math.max(0, g));
          d[i + 2] = Math.min(255, Math.max(0, b));
          d[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    },
    {
      wrap: THREE.ClampToEdgeWrapping,
      colorSpace: THREE.SRGBColorSpace,
    },
  );
}

/** Hermite smoothstep for procedural env bands. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** @deprecated Prefer createZenGardenEnvEquirectTexture */
export function createStudioEnvEquirectTexture(): THREE.CanvasTexture {
  return createZenGardenEnvEquirectTexture();
}

/** Subtle seamless floor texture — warm concrete / linen grain. */
export function createGroundAlbedoTexture(): THREE.CanvasTexture {
  return canvasTexture(
    256,
    (ctx, size) => {
      const img = ctx.createImageData(size, size);
      const d = img.data;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const u = x / size;
          const v = y / size;
          const n = fbm(u * 8, v * 8, 4);
          const fine = fbm(u * 32, v * 32, 2);
          // Pale warm stone
          const base = 210 + n * 18 + fine * 8;
          const r = base + 4;
          const g = base;
          const b = base - 8;
          const i = (y * size + x) * 4;
          d[i] = Math.min(255, r);
          d[i + 1] = Math.min(255, g);
          d[i + 2] = Math.min(255, Math.max(0, b));
          d[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    },
    { colorSpace: THREE.SRGBColorSpace },
  );
}

/** Stone pedestal albedo — slightly cooler / denser than floor. */
export function createPedestalAlbedoTexture(): THREE.CanvasTexture {
  return canvasTexture(
    256,
    (ctx, size) => {
      const img = ctx.createImageData(size, size);
      const d = img.data;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const u = x / size;
          const v = y / size;
          const n = fbm(u * 10, v * 6, 4);
          const vein = fbm(u * 3, v * 14, 2);
          let r = 185 + n * 28;
          let g = 180 + n * 24;
          let b = 170 + n * 20;
          // Soft mineral veins
          if (vein > 0.62) {
            r -= 12;
            g -= 10;
            b -= 6;
          }
          const i = (y * size + x) * 4;
          d[i] = Math.min(255, r);
          d[i + 1] = Math.min(255, g);
          d[i + 2] = Math.min(255, b);
          d[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    },
    { colorSpace: THREE.SRGBColorSpace },
  );
}
