/**
 * End-to-end boot smoke: catches the failure mode where the app stays on
 * HTML defaults (Age "—", Season "—", Vitality "—") and buttons never bind.
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

  // Wait until HUD leaves HTML defaults (index.html: Age/Season/Vitality "—")
  await page.waitForFunction(
    () => {
      const age = document.getElementById('info-age')?.textContent?.trim();
      const season = document.getElementById('info-season')?.textContent?.trim();
      const vitality = document.getElementById('info-reserves')?.textContent?.trim();
      if (!age || !season || !vitality) return false;
      // Not the static HTML placeholders
      if (age === '—' || season === '—' || vitality === '—') return false;
      return true;
    },
    { timeout: 30000 },
  );

  const hud = await page.evaluate(() => ({
    age: document.getElementById('info-age')?.textContent?.trim(),
    season: document.getElementById('info-season')?.textContent?.trim(),
    vitality: document.getElementById('info-reserves')?.textContent?.trim(),
    status: document.getElementById('status')?.textContent?.trim(),
  }));

  // Fresh / recovered sapling must not show HTML default placeholders
  if (hud.age === '—' || hud.season === '—' || hud.vitality === '—') {
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
  // Headless rAF can be throttled; wait until HUD age actually changes
  // rather than a fixed wall-clock sleep (was flaky under load).
  try {
    await page.waitForFunction(
      (before) => {
        const age = document.getElementById('info-age')?.textContent?.trim();
        return Boolean(age && age !== before);
      },
      { timeout: 8000 },
      hud.age,
    );
  } catch {
    const ageAfter = await page.evaluate(() =>
      document.getElementById('info-age')?.textContent?.trim(),
    );
    throw new Error(
      `Time control did not advance age (before=${hud.age}, after=${ageAfter})`,
    );
  }
  const ageAfter = await page.evaluate(() =>
    document.getElementById('info-age')?.textContent?.trim(),
  );

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
