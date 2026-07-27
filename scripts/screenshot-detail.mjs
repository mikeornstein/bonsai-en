/**
 * Close-up realism audit plates (issue #57).
 *
 * Usage (dev server running):
 *   npm run screenshots:detail
 *   # or: BONSAI_URL=http://localhost:5173/ node scripts/screenshot-detail.mjs
 *
 * Outputs (gitignored screenshots/):
 *   10-detail-nebari-front.png
 *   11-detail-nebari-top.png
 *   12-detail-joint-primary.png
 *   13-detail-joint-fork.png
 *   14-detail-foliage-origin.png
 *   15-detail-foliage-edge.png
 *
 * Deterministic: newSapling → fixed growth → pause → freeze physics →
 * practice ghost off → setCloseUp framing.
 *
 * Soft-GL (SwiftShader) skips product DOF/grade — note in PR if comparing materials.
 */
import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(dir, { recursive: true });

const BASE_URL = process.env.BONSAI_URL || 'http://localhost:5173/';
const WIDTH = 1440;
const HEIGHT = 900;

const browser = await puppeteer.launch({
  headless: true,
  protocolTimeout: 180000,
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
  ],
});

async function waitForHarness(page) {
  await page.waitForFunction(
    () =>
      typeof window.__bonsai?.setCloseUp === 'function' &&
      typeof window.__bonsai?.newSapling === 'function' &&
      typeof window.__bonsai?.listNodes === 'function',
    { timeout: 30000 },
  );
}

async function settleFrames(page) {
  try {
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  } catch {
    /* HMR */
  }
  await new Promise((r) => setTimeout(r, 350));
}

/**
 * Fresh page: clear storage, new sapling, grow a fixed amount, freeze for stills.
 * Returns page ready for setCloseUp shots (UI hidden, practice off, physics frozen).
 */
async function prepareDetailPage() {
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 2 });
  page.on('dialog', async (d) => {
    try {
      await d.accept();
    } catch {
      /* ignore */
    }
  });

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#btn-new', { timeout: 30000 });
  await waitForHarness(page);
  // Procedural textures + PMREM
  await new Promise((r) => setTimeout(r, 3500));
  await waitForHarness(page);

  await page.evaluate(() => {
    window.__bonsai.newSapling();
    window.__bonsai.setSumiChallenge(false);
    window.__bonsai.setMuted(true);
    window.__bonsai.setUiVisible(false);
  });
  await new Promise((r) => setTimeout(r, 800));

  // Deterministic growth window — enough structure for joints + pads
  await page.evaluate(() => window.__bonsai.setSpeed('year'));
  await new Promise((r) => setTimeout(r, 4200));
  await page.evaluate(() => {
    window.__bonsai.setSpeed('pause');
    window.__bonsai.setPhysicsFrozen(true);
  });
  await new Promise((r) => setTimeout(r, 500));
  await settleFrames(page);
  return page;
}

async function shot(page, name) {
  await settleFrames(page);
  const file = path.join(dir, name);
  await page.screenshot({ path: file, type: 'png' });
  console.log('wrote', file);
}

const page = await prepareDetailPage();

// ── R · Nebari / soil–trunk ──────────────────────────────────────────
await page.evaluate(() => {
  // Soil origin in tree-local space (root base ~0)
  window.__bonsai.setCloseUp({
    x: 0,
    y: 0.004,
    z: 0,
    distance: 0.09,
    azimuth: 0.15,
    elevation: 0.18,
    fov: 26,
  });
});
await shot(page, '10-detail-nebari-front.png');

await page.evaluate(() => {
  window.__bonsai.setCloseUp({
    x: 0,
    y: 0.006,
    z: 0,
    distance: 0.11,
    azimuth: 0.4,
    elevation: 1.05,
    fov: 28,
  });
});
await shot(page, '11-detail-nebari-top.png');

// ── J · Joints ───────────────────────────────────────────────────────
const targets = await page.evaluate(() => {
  const nodes = window.__bonsai.listNodes();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const living = nodes.filter((n) => n.living && n.parentId != null);

  // True crotches: child of a parent that has 2+ kids, above soil flare
  const crotches = living
    .filter((n) => {
      const p = byId.get(n.parentId);
      return (
        p &&
        (p.childCount ?? 0) >= 2 &&
        n.baseY > 0.035 &&
        n.radius > 0.0012
      );
    })
    .sort((a, b) => b.radius - a.radius || b.baseY - a.baseY);

  // Primary: thickest true crotch (branch leaving wood mid-canopy)
  const midLaterals = living
    .filter((n) => n.baseY > 0.04 && n.radius > 0.0015 && !n.isLeaf)
    .sort((a, b) => b.radius - a.radius);
  const primary = crotches[0] ?? midLaterals[0] ?? living[0];

  // Fork: parent tip collar with 2+ children — prefer different from primary
  const forks = living
    .filter((n) => (n.childCount ?? 0) >= 2 && n.tipY > 0.04)
    .sort((a, b) => b.radius - a.radius || b.childCount - a.childCount);
  const fork =
    forks.find((f) => f.id !== primary?.parentId && f.id !== primary?.id) ??
    forks[0] ??
    midLaterals[1] ??
    primary;

  // Foliage host: living leaf with pads — prefer higher tips with some length
  const tips = living
    .filter((n) => n.isLeaf && n.length > 0.008)
    .sort((a, b) => b.tipY - a.tipY || b.length - a.length);
  const foliage = tips[0] ?? living[living.length - 1] ?? primary;

  return {
    primary: primary
      ? {
          x: primary.baseX,
          y: primary.baseY,
          z: primary.baseZ,
          r: primary.radius,
          id: primary.id,
        }
      : { x: 0, y: 0.04, z: 0, r: 0.002, id: null },
    fork: fork
      ? {
          x: fork.tipX,
          y: fork.tipY,
          z: fork.tipZ,
          r: fork.radius,
          id: fork.id,
        }
      : { x: 0, y: 0.05, z: 0, r: 0.002, id: null },
    foliage: foliage
      ? {
          x: (foliage.baseX + foliage.tipX) * 0.5,
          y: (foliage.baseY + foliage.tipY) * 0.5,
          z: (foliage.baseZ + foliage.tipZ) * 0.5,
          tipX: foliage.tipX,
          tipY: foliage.tipY,
          tipZ: foliage.tipZ,
          r: foliage.radius,
          id: foliage.id,
        }
      : {
          x: 0,
          y: 0.08,
          z: 0,
          tipX: 0,
          tipY: 0.1,
          tipZ: 0,
          r: 0.001,
          id: null,
        },
    counts: {
      living: living.length,
      nodes: nodes.length,
      crotches: crotches.length,
      forks: forks.length,
    },
  };
});

console.log('joint/foliage targets', JSON.stringify(targets, null, 2));

await page.evaluate((t) => {
  window.__bonsai.setCloseUp({
    x: t.primary.x,
    y: t.primary.y,
    z: t.primary.z,
    distance: Math.max(0.05, Math.min(0.12, t.primary.r * 22 + 0.035)),
    azimuth: 0.85,
    elevation: 0.38,
    fov: 22,
  });
}, targets);
await shot(page, '12-detail-joint-primary.png');

await page.evaluate((t) => {
  window.__bonsai.setCloseUp({
    x: t.fork.x,
    y: t.fork.y,
    z: t.fork.z,
    distance: Math.max(0.045, Math.min(0.1, t.fork.r * 24 + 0.03)),
    azimuth: -0.9,
    elevation: 0.42,
    fov: 22,
  });
}, targets);
await shot(page, '13-detail-joint-fork.png');

// ── F · Foliage origins / edge ───────────────────────────────────────
await page.evaluate((t) => {
  window.__bonsai.setCloseUp({
    x: t.foliage.x,
    y: t.foliage.y,
    z: t.foliage.z,
    distance: 0.038,
    azimuth: 0.9,
    elevation: 0.35,
    fov: 22,
  });
}, targets);
await shot(page, '14-detail-foliage-origin.png');

await page.evaluate((t) => {
  // Pad silhouette against cyclorama — slight offset past tip
  window.__bonsai.setCloseUp({
    x: t.foliage.tipX * 0.85,
    y: t.foliage.tipY + 0.008,
    z: t.foliage.tipZ * 0.85,
    distance: 0.055,
    azimuth: 1.4,
    elevation: 0.15,
    fov: 26,
  });
}, targets);
await shot(page, '15-detail-foliage-edge.png');

await page.close();
await browser.close();
console.log('done — detail plates 10–15');
