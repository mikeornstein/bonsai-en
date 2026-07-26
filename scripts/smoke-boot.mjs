/**
 * End-to-end boot smoke: catches the failure mode where the app stays on
 * HTML defaults (Age "0 d", Season "—", Nodes "—") and buttons never bind.
 *
 * Usage (dev server or preview must be up):
 *   BOOT_URL=http://localhost:5173 node scripts/smoke-boot.mjs
 */
import puppeteer from 'puppeteer';

const url = process.env.BOOT_URL || 'http://localhost:5173/';

const browser = await puppeteer.launch({
  headless: true,
  protocolTimeout: 120000,
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
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // Give Vite/preview a moment to finish serving modules
  await page.waitForSelector('#btn-new', { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 1500));

  // Wait until HUD leaves HTML defaults (index.html: "0 d", "—", "—")
  await page.waitForFunction(
    () => {
      const age = document.getElementById('info-age')?.textContent?.trim();
      const season = document.getElementById('info-season')?.textContent?.trim();
      const nodes = document.getElementById('info-nodes')?.textContent?.trim();
      if (!age || !season || !nodes) return false;
      // Not the static HTML placeholders
      if (season === '—' || nodes === '—') return false;
      const n = Number(nodes);
      return Number.isFinite(n) && n > 0;
    },
    { timeout: 30000 },
  );

  const hud = await page.evaluate(() => ({
    age: document.getElementById('info-age')?.textContent?.trim(),
    season: document.getElementById('info-season')?.textContent?.trim(),
    nodes: document.getElementById('info-nodes')?.textContent?.trim(),
    status: document.getElementById('status')?.textContent?.trim(),
  }));

  // Fresh / recovered sapling must not show HTML default age alone with empty meta
  if (hud.season === '—' || hud.nodes === '—' || hud.nodes === '0') {
    throw new Error(`Boot left HTML-default HUD: ${JSON.stringify(hud)}`);
  }
  if (hud.status?.startsWith('Boot failed')) {
    throw new Error(`Boot failed status: ${hud.status}`);
  }

  // Buttons must be bound (failure mode: bindUi never ran)
  await page.click('button[data-tool="prune"]');
  const pruneActive = await page.evaluate(() =>
    document.querySelector('[data-tool="prune"]')?.classList.contains('active'),
  );
  if (!pruneActive) {
    throw new Error('Prune button click did not toggle .active — UI not bound');
  }

  await page.click('button[data-speed="year"]');
  await new Promise((r) => setTimeout(r, 1200));
  const ageAfter = await page.evaluate(() =>
    document.getElementById('info-age')?.textContent?.trim(),
  );
  if (!ageAfter || ageAfter === hud.age) {
    // Year mode should advance plant age if the game loop is running
    // Allow equality only if already paused somehow — require change for year
    throw new Error(
      `Time control did not advance age (before=${hud.age}, after=${ageAfter})`,
    );
  }

  if (pageErrors.length) {
    throw new Error(`Page errors during boot: ${pageErrors.join('; ')}`);
  }

  console.log('smoke-boot ok', { ...hud, ageAfter, pruneActive });
  await browser.close();
  process.exit(0);
} catch (err) {
  console.error('smoke-boot FAILED', err.message || err);
  await browser.close().catch(() => {});
  process.exit(1);
}
