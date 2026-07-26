/**
 * Capture verification screenshots of the running dev server.
 * Usage: node scripts/screenshot.mjs
 */
import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(dir, { recursive: true });

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

async function freshPage(width, height) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 2 });
  page.on('dialog', async (d) => {
    await d.accept();
  });
  // Avoid networkidle0 — WebGL/HMR can keep the network "busy" forever.
  await page.goto('http://localhost:5173/', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForSelector('#btn-new', { timeout: 30000 });
  // Give the main thread time to finish procedural textures + PMREM
  await new Promise((r) => setTimeout(r, 4000));
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#btn-new', { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 4000));
  await page.click('#btn-new');
  await new Promise((r) => setTimeout(r, 2500));
  return page;
}

async function shot(name, { width, height, actions } = {}) {
  const page = await freshPage(width, height);
  if (actions) await actions(page);
  await new Promise((r) => setTimeout(r, 500));
  // Wait a couple animation frames
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  const file = path.join(dir, name);
  await page.screenshot({ path: file, type: 'png' });
  console.log('wrote', file);
  await page.close();
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

await browser.close();
console.log('done');
