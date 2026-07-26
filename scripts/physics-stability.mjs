/**
 * Capture sequential frames + physics telemetry with a stationary camera.
 * Usage: node scripts/physics-stability.mjs
 * Requires: npm run dev on :5173
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

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
const base = process.env.BONSAI_URL || 'http://localhost:5173/';
await page.goto(base, {
  waitUntil: 'domcontentloaded',
  timeout: 60000,
});
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(
  () =>
    typeof window.__bonsai?.newSapling === 'function' &&
    typeof window.__bonsai?.getPhysicsTelemetry === 'function',
  { timeout: 30000 },
);
await new Promise((r) => setTimeout(r, 2500));
await page.evaluate(() => window.__bonsai.newSapling());
// Let gravity settle with stationary camera
await new Promise((r) => setTimeout(r, 2000));

const series = [];
for (let i = 0; i < 6; i++) {
  await new Promise((r) => setTimeout(r, 200));
  const tel = await page.evaluate(() => window.__bonsai.getPhysicsTelemetry());
  series.push(tel);
  const file = path.join(dir, `physics-seq-${String(i).padStart(2, '0')}.png`);
  await page.screenshot({ path: file, type: 'png' });
  console.log(
    `frame ${i}: maxΩ=${tel.maxOmega.toFixed(4)} rmsΩ=${tel.rmsOmega.toFixed(4)} KE=${tel.kineticEnergy.toExponential(2)} sleep=${tel.sleeping}/${tel.freeJoints} contacts=${tel.contacts}`,
  );
}

const last = series[series.length - 1];
const ok = last.maxOmega < 0.08 && last.kineticEnergy < 1e-4;
console.log(ok ? 'STABILITY OK' : 'STABILITY FAIL', JSON.stringify(last));

fs.writeFileSync(
  path.join(dir, 'physics-telemetry.json'),
  JSON.stringify({ series, ok }, null, 2),
);

await browser.close();
process.exit(ok ? 0 : 1);
