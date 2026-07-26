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

/** Vertical bark grain albedo (sRGB). */
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
          // Strong vertical grain + plate cracks
          const grain = fbm(u * 6, v * 28, 5);
          const plate = fbm(u * 3.5, v * 2.2, 3);
          const crack =
            Math.abs(Math.sin(u * Math.PI * 8 + plate * 4)) < 0.06
              ? 0.25
              : 0;
          const ridge = fbm(u * 18, v * 4, 2);

          let r = 92 + grain * 55 + ridge * 20;
          let g = 58 + grain * 30 + ridge * 10;
          let b = 38 + grain * 18;

          // Darker fissures
          r -= crack * 50 + (1 - plate) * 18;
          g -= crack * 35 + (1 - plate) * 12;
          b -= crack * 25 + (1 - plate) * 8;

          // Occasional lichen hint
          if (fbm(u * 20, v * 20, 2) > 0.72) {
            r = r * 0.75 + 40;
            g = g * 0.7 + 55;
            b = b * 0.7 + 30;
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
      const grain = fbm(u * 6, v * 28, 5);
      const plate = fbm(u * 3.5, v * 2.2, 3);
      const crack =
        Math.abs(Math.sin(u * Math.PI * 8 + plate * 4)) < 0.06 ? 0.4 : 0;
      height[y * size + x] = grain * 0.7 + plate * 0.25 - crack;
    }
  }

  return canvasTexture(size, (ctx, s) => {
    const img = ctx.createImageData(s, s);
    const d = img.data;
    const strength = 2.8;
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
        const g = fbm(u * 8, v * 20, 3);
        const r = 0.55 + g * 0.4;
        const c = Math.floor(r * 255);
        const i = (y * size + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = c;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
}

/** Soft scale foliage albedo with edge darkening. */
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
      const cy = size * 0.52;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          // Soft elliptical scale (juniper-ish), not sharp diamond
          const nx = (x - cx) / (size * 0.38);
          const ny = (y - cy) / (size * 0.46);
          const r2 = nx * nx + ny * ny;
          const edge = Math.max(0, 1 - r2);
          const alpha = edge > 0.02 ? Math.min(1, edge * 1.65) : 0;
          const vein = 1 - Math.abs(nx) * 0.25;
          const n = fbm(x * 0.09, y * 0.09, 2);
          const i = (y * size + x) * 4;
          // Keep green RGB even when alpha=0 to avoid black edge fringing
          d[i] = Math.min(255, br * vein * (0.88 + n * 0.18));
          d[i + 1] = Math.min(255, bg * vein * (0.88 + n * 0.22));
          d[i + 2] = Math.min(255, bb * vein * (0.88 + n * 0.14));
          d[i + 3] = Math.floor(alpha * 255);
        }
      }
      ctx.putImageData(img, 0, 0);
    },
    { wrap: THREE.ClampToEdgeWrapping, colorSpace: THREE.SRGBColorSpace },
  );
}

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
          const n = fbm(u * 14, v * 14, 4);
          const pebble = fbm(u * 40, v * 40, 2);
          // Cooler gray-brown akadama / pumice mix
          let r = 72 + n * 38;
          let g = 58 + n * 28;
          let b = 42 + n * 18;
          if (pebble > 0.66) {
            r += 30;
            g += 24;
            b += 16;
          }
          // grit flecks
          if (hash2(x * 0.3, y * 0.3) > 0.91) {
            r = 140;
            g = 105;
            b = 70;
          }
          if (hash2(x * 0.7, y * 0.5) > 0.94) {
            r = 90;
            g = 88;
            b = 82;
          }
          const i = (y * size + x) * 4;
          d[i] = r;
          d[i + 1] = g;
          d[i + 2] = b;
          d[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    },
    { colorSpace: THREE.SRGBColorSpace },
  );
}

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
          const n = fbm(u * 6, v * 8, 3);
          const glaze = 0.85 + n * 0.2;
          const r = (110 + n * 25) * glaze;
          const g = (55 + n * 15) * glaze;
          const b = (42 + n * 10) * glaze;
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

/**
 * Light product-studio cyclorama — warm linen sky falling to cool stone floor.
 * Used as scene.background (equirect-ish vertical gradient via low-res map).
 */
export function createStudioBackgroundTexture(): THREE.CanvasTexture {
  return canvasTexture(
    8,
    (ctx, size) => {
      const g = ctx.createLinearGradient(0, 0, 0, size);
      // Top: soft cool daylight
      g.addColorStop(0, '#eef1f4');
      // Mid: warm linen / paper
      g.addColorStop(0.42, '#e6e1d8');
      // Lower: soft stone gray
      g.addColorStop(0.78, '#d4cfc6');
      g.addColorStop(1, '#c4bfb6');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
    },
    { wrap: THREE.ClampToEdgeWrapping, colorSpace: THREE.SRGBColorSpace },
  );
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
