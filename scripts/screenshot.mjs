/**
 * Capture verification screenshots of the running dev server.
 * Usage: node scripts/screenshot.mjs
 *
 * Requires: npm run dev (http://localhost:5173)
 * Outputs: screenshots/*.png (gitignored)
 *
 * Views 01–04: product baselines with UI.
 * Views 05–09: orthographic geometry audits (UI hidden).
 */
import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(dir, { recursive: true });

const BASE_URL = process.env.BONSAI_URL || 'http://localhost:5173/';

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
      typeof window.__bonsai?.setView === 'function' &&
      typeof window.__bonsai?.newSapling === 'function',
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
    // HMR can destroy the context; wait and continue
  }
  await new Promise((r) => setTimeout(r, 400));
}

async function freshPage(width, height) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 2 });
  page.on('dialog', async (d) => {
    try {
      await d.accept();
    } catch {
      /* ignore */
    }
  });
  // Clear storage before first paint so we don't need a mid-session reload
  await page.goto(BASE_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#btn-new', { timeout: 30000 });
  await waitForHarness(page);
  // Procedural textures + PMREM
  await new Promise((r) => setTimeout(r, 3500));
  await waitForHarness(page);
  // Harness path — no confirm dialog, no click/navigation races
  await page.evaluate(() => {
    window.__bonsai.newSapling();
  });
  await new Promise((r) => setTimeout(r, 2000));
  return page;
}

async function shot(name, { width, height, actions } = {}) {
  const page = await freshPage(width, height);
  if (actions) await actions(page);
  await settleFrames(page);
  const file = path.join(dir, name);
  await page.screenshot({ path: file, type: 'png' });
  console.log('wrote', file);
  await page.close();
}

async function orthoShot(name, view, { width = 1440, height = 900 } = {}) {
  await shot(name, {
    width,
    height,
    actions: async (page) => {
      await page.evaluate((v) => {
        window.__bonsai.setUiVisible(false);
        window.__bonsai.setView(v);
      }, view);
      await settleFrames(page);
    },
  });
}

await shot('01-desktop.png', { width: 1440, height: 900 });

await shot('02-mobile.png', { width: 390, height: 844 });

await shot('03-after-growth.png', {
  width: 1440,
  height: 900,
  actions: async (page) => {
    await page.click('button[data-speed="year"]');
    await new Promise((r) => setTimeout(r, 3500));
    await page.click('button[data-speed="0"]');
    await new Promise((r) => setTimeout(r, 600));
  },
});

await shot('04-orbit.png', {
  width: 1440,
  height: 900,
  actions: async (page) => {
    const canvas = await page.$('#c');
    const box = await canvas.boundingBox();
    const cx = box.x + box.width * 0.55;
    const cy = box.y + box.height * 0.45;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx - 140, cy + 10, { steps: 14 });
    await page.mouse.up();
    await new Promise((r) => setTimeout(r, 500));
  },
});

// Orthographic geometry audits — UI hidden so pot/soil leaks are obvious
await orthoShot('05-ortho-front.png', 'front');
await orthoShot('06-ortho-right.png', 'right');
await orthoShot('07-ortho-top.png', 'top');
await orthoShot('08-ortho-top-close.png', 'top-close');
await orthoShot('09-ortho-front-low.png', 'front-low');

await browser.close();
console.log('done');
