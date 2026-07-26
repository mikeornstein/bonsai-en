/**
 * Automated playtest runner: scripted player flows + evidence report.
 *
 * Usage (dev server must be up):
 *   npm run playtest
 *   BONSAI_URL=http://localhost:5173 node scripts/playtest.mjs
 *
 * Outputs (gitignored):
 *   playtest-reports/latest.json
 *   playtest-reports/latest.md
 *   playtest-reports/shots/*.png
 */
import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const REPORT_DIR = path.resolve(ROOT, 'playtest-reports');
const SHOT_DIR = path.join(REPORT_DIR, 'shots');
const BASE_URL = process.env.BONSAI_URL || 'http://localhost:5173/';

fs.mkdirSync(SHOT_DIR, { recursive: true });

/** @typedef {'blocker'|'bug'|'playability'|'performance'|'polish'|'info'} Severity */
/** @typedef {{ id: string; severity: Severity; title: string; detail: string; scenario?: string }} Finding */
/** @typedef {{ id: string; name: string; ok: boolean; hard: boolean; durationMs: number; notes: string[]; snapshot?: object; perf?: object }} ScenarioResult */

const findings = /** @type {Finding[]} */ ([]);
const results = /** @type {ScenarioResult[]} */ ([]);
const pageErrors = [];
const consoleErrors = [];
let hardFail = false;

function addFinding(severity, title, detail, scenario) {
  findings.push({
    id: `F${String(findings.length + 1).padStart(2, '0')}`,
    severity,
    title,
    detail,
    scenario,
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHarness(page) {
  await page.waitForFunction(
    () =>
      typeof window.__bonsai?.getSnapshot === 'function' &&
      typeof window.__bonsai?.act === 'function' &&
      typeof window.__bonsai?.newSapling === 'function',
    { timeout: 30000 },
  );
}

async function snap(page) {
  return page.evaluate(() => window.__bonsai.getSnapshot());
}

async function listNodes(page) {
  return page.evaluate(() => window.__bonsai.listNodes());
}

async function getPerf(page) {
  return page.evaluate(() => window.__bonsai.getPerf());
}

async function shot(page, name) {
  const file = path.join(SHOT_DIR, name);
  await page.screenshot({ path: file, type: 'png' });
  return file;
}

/**
 * @param {string} id
 * @param {string} name
 * @param {boolean} hard — if true, failure fails the process
 * @param {(ctx: { page: import('puppeteer').Page }) => Promise<string[]|void>} fn
 */
async function scenario(page, id, name, hard, fn) {
  const t0 = Date.now();
  const notes = [];
  let ok = true;
  let snapshot;
  let perf;
  console.log(`\n▶ ${id} ${name}`);
  try {
    const extra = await fn({ page });
    if (Array.isArray(extra)) notes.push(...extra);
    snapshot = await snap(page).catch(() => undefined);
    perf = await getPerf(page).catch(() => undefined);
  } catch (err) {
    ok = false;
    notes.push(String(err.message || err));
    if (hard) hardFail = true;
    addFinding(
      hard ? 'blocker' : 'bug',
      `${id} failed: ${name}`,
      String(err.message || err),
      id,
    );
  }
  const durationMs = Date.now() - t0;
  results.push({ id, name, ok, hard, durationMs, notes, snapshot, perf });
  console.log(
    `  ${ok ? '✓' : '✗'} ${durationMs}ms${notes.length ? ' — ' + notes.join('; ') : ''}`,
  );
  return ok;
}

function pickPruneTarget(nodes) {
  // Prefer living non-root leaf; else any living non-root
  const living = nodes.filter((n) => n.living && n.parentId);
  const leaf = living.find((n) => n.isLeaf);
  return leaf || living[0] || null;
}

function pickWireTarget(nodes) {
  const living = nodes.filter((n) => n.living && n.parentId && !n.hasWire);
  // Prefer mid-length branches over tiny tips
  living.sort((a, b) => b.length - a.length);
  return living[0] || null;
}

function pickPinchTarget(nodes) {
  const leaves = nodes.filter((n) => n.living && n.isLeaf && n.parentId);
  return leaves[0] || null;
}

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

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
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('dialog', async (d) => {
  try {
    await d.accept();
  } catch {
    /* ignore */
  }
});

// Grant clipboard for share scenario
const ctx = browser.defaultBrowserContext();
try {
  await ctx.overridePermissions(new URL(BASE_URL).origin, ['clipboard-read', 'clipboard-write']);
} catch {
  /* headless may ignore */
}

// ── Boot page ──────────────────────────────────────────────────────────────
await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#btn-new', { timeout: 30000 });
await waitForHarness(page);
await sleep(2000);

// ── S0 Boot ────────────────────────────────────────────────────────────────
await scenario(page, 'S0', 'Boot', true, async () => {
  const notes = [];
  const hud = await page.evaluate(() => ({
    age: document.getElementById('info-age')?.textContent?.trim(),
    season: document.getElementById('info-season')?.textContent?.trim(),
    vitality: document.getElementById('info-reserves')?.textContent?.trim(),
    status: document.getElementById('status')?.textContent?.trim(),
  }));
  if (hud.age === '—' || hud.season === '—' || hud.vitality === '—') {
    throw new Error(`HUD stuck on placeholders: ${JSON.stringify(hud)}`);
  }
  if (hud.status?.startsWith('Boot failed')) {
    throw new Error(hud.status);
  }
  const s = await snap(page);
  notes.push(`age=${s.ageLabel}, nodes=${s.nodeCount}, season=${s.season}`);
  await shot(page, 'S0-boot.png');
  return notes;
});

// ── S1 New sapling ─────────────────────────────────────────────────────────
await scenario(page, 'S1', 'New sapling', true, async () => {
  await page.evaluate(() => window.__bonsai.newSapling());
  await sleep(800);
  const s = await snap(page);
  if (s.nodeCount < 1) throw new Error('Sapling has no nodes');
  // createSapling() intentionally starts ~120 plant-days ("4 months")
  if (s.agePlantDays > 200) {
    addFinding(
      'bug',
      'New sapling unexpectedly old',
      `agePlantDays=${s.agePlantDays} after newSapling() (expected ~120)`,
      'S1',
    );
  }
  await shot(page, 'S1-sapling.png');
  return [`nodes=${s.nodeCount}, age=${s.ageLabel} (day ${s.agePlantDays})`];
});

// ── S2 Time controls (UI path) ─────────────────────────────────────────────
await scenario(page, 'S2', 'Time controls (UI)', true, async () => {
  const notes = [];
  const before = await snap(page);

  await page.click('button[data-speed="year"]');
  await page.waitForFunction(
    (prev) => {
      const s = window.__bonsai.getSnapshot();
      return s.agePlantDays > prev + 5;
    },
    { timeout: 12000 },
    before.agePlantDays,
  );
  const mid = await snap(page);
  notes.push(`years advanced: ${before.agePlantDays.toFixed(1)} → ${mid.agePlantDays.toFixed(1)}`);

  await page.click('button[data-speed="0"]');
  await sleep(400);
  const paused = await snap(page);
  await sleep(600);
  const still = await snap(page);
  if (Math.abs(still.agePlantDays - paused.agePlantDays) > 0.01) {
    throw new Error(
      `Still did not freeze age (${paused.agePlantDays} → ${still.agePlantDays})`,
    );
  }
  notes.push('Still freezes age');

  // UI bind: tool buttons
  await page.click('button[data-tool="prune"]');
  const pruneActive = await page.evaluate(() =>
    document.querySelector('[data-tool="prune"]')?.classList.contains('active'),
  );
  if (!pruneActive) throw new Error('Prune button did not activate');
  await page.click('button[data-tool="inspect"]');
  return notes;
});

// ── S3 Grow young tree ─────────────────────────────────────────────────────
await scenario(page, 'S3', 'Grow young tree', true, async () => {
  const notes = [];
  const before = await snap(page);
  await page.evaluate(() => window.__bonsai.setSpeed('year'));
  const t0 = Date.now();
  await page.waitForFunction(
    (prevNodes) => window.__bonsai.getSnapshot().nodeCount > prevNodes,
    { timeout: 20000 },
    before.nodeCount,
  );
  // Grow a bit more for a useful canopy
  await sleep(3500);
  await page.evaluate(() => window.__bonsai.setSpeed('pause'));
  await sleep(500);
  const after = await snap(page);
  const wall = Date.now() - t0;
  notes.push(
    `nodes ${before.nodeCount}→${after.nodeCount}, age ${after.ageLabel}, wall=${wall}ms, vitality=${after.vitalityWord}`,
  );
  if (!(after.reserves >= 0) || !Number.isFinite(after.reserves)) {
    throw new Error(`Invalid reserves: ${after.reserves}`);
  }
  if (after.nodeCount <= before.nodeCount) {
    throw new Error('Node count did not increase during years growth');
  }
  if (after.vitalityWord === 'Low' || after.reserves < 6) {
    addFinding(
      'playability',
      'Vitality drops to Low after short Years growth',
      `After ~4s Years: vitality=${after.vitalityWord}, reserves=${after.reserves.toFixed(1)}, season=${after.season}. Players may think the tree is dying when fast-forwarding.`,
      'S3',
    );
  }
  await shot(page, 'S3-grown.png');
  return notes;
});

// ── S4 Inspect ─────────────────────────────────────────────────────────────
await scenario(page, 'S4', 'Inspect branch', false, async () => {
  const nodes = await listNodes(page);
  const target = pickPruneTarget(nodes) || nodes[0];
  if (!target) throw new Error('No nodes to inspect');
  const r = await page.evaluate(
    (id) => window.__bonsai.act('inspect', id),
    target.id,
  );
  if (!r.ok) throw new Error(r.message);
  const sel = await page.evaluate(
    () => document.getElementById('info-selection')?.textContent?.trim(),
  );
  if (!sel || sel.length < 2) {
    addFinding(
      'bug',
      'Inspect selection empty',
      `info-selection="${sel}" after act(inspect)`,
      'S4',
    );
  }
  return [`selected=${target.id}, hud="${sel}"`];
});

// ── S5 Prune ───────────────────────────────────────────────────────────────
await scenario(page, 'S5', 'Prune branch', true, async () => {
  const before = await snap(page);
  const nodes = await listNodes(page);
  const target = pickPruneTarget(nodes);
  if (!target) throw new Error('No prune target');
  const r = await page.evaluate(
    (id) => window.__bonsai.act('prune', id),
    target.id,
  );
  if (!r.ok) throw new Error(`Prune failed: ${r.message}`);
  await sleep(600);
  const after = await snap(page);
  if (after.nodeCount >= before.nodeCount) {
    throw new Error(
      `Prune did not reduce nodes (${before.nodeCount} → ${after.nodeCount})`,
    );
  }
  // Physics should wake then ideally settle later
  const tel = after.physics;
  await shot(page, 'S5-pruned.png');
  return [
    `pruned ${target.id}, nodes ${before.nodeCount}→${after.nodeCount}, maxΩ=${tel.maxOmega.toFixed(3)}`,
  ];
});

// ── S6 Pinch ───────────────────────────────────────────────────────────────
await scenario(page, 'S6', 'Pinch tip', false, async () => {
  const nodes = await listNodes(page);
  const target = pickPinchTarget(nodes);
  if (!target) {
    addFinding('playability', 'No pinch target after prune', 'Tree may be too small', 'S6');
    return ['skipped — no tip'];
  }
  const r = await page.evaluate(
    (id) => window.__bonsai.act('pinch', id),
    target.id,
  );
  if (!r.ok) {
    addFinding('bug', 'Pinch rejected', r.message, 'S6');
    return [`pinch not ok: ${r.message}`];
  }
  return [`pinched ${target.id}: ${r.message}`];
});

// ── S7 Wire / bend / unwire ────────────────────────────────────────────────
await scenario(page, 'S7', 'Wire bend unwire', true, async () => {
  const notes = [];
  // Grow a bit more so we have wireable wood
  await page.evaluate(() => window.__bonsai.setSpeed('year'));
  await sleep(2000);
  await page.evaluate(() => window.__bonsai.setSpeed('pause'));
  await sleep(400);

  let nodes = await listNodes(page);
  let target = pickWireTarget(nodes);
  if (!target) throw new Error('No wire target');
  let r = await page.evaluate(
    (id) => window.__bonsai.act('wire', id),
    target.id,
  );
  if (!r.ok) throw new Error(`Wire failed: ${r.message}`);
  notes.push(`wired ${target.id}`);

  r = await page.evaluate(
    (id) => window.__bonsai.bend(id, [0.4, 0.2, 0.9]),
    target.id,
  );
  if (!r.ok) throw new Error(`Bend failed: ${r.message}`);
  notes.push('bent');

  // Advance plant time so set amount can increase
  await page.evaluate(() => window.__bonsai.setSpeed('month'));
  await sleep(2500);
  await page.evaluate(() => window.__bonsai.setSpeed('pause'));
  nodes = await listNodes(page);
  const wired = nodes.find((n) => n.id === target.id);
  if (wired?.wireSetAmount != null) {
    notes.push(`setAmount=${wired.wireSetAmount.toFixed(3)}`);
    if (wired.wireSetAmount < 0.001) {
      addFinding(
        'playability',
        'Wire set amount not progressing under Month speed',
        `After ~2.5s month speed, setAmount=${wired.wireSetAmount}`,
        'S7',
      );
    }
  }

  r = await page.evaluate(
    (id) => window.__bonsai.act('unwire', id),
    target.id,
  );
  if (!r.ok) throw new Error(`Unwire failed: ${r.message}`);
  nodes = await listNodes(page);
  if (nodes.find((n) => n.id === target.id)?.hasWire) {
    throw new Error('Wire still present after unwire');
  }
  notes.push('unwired');
  await shot(page, 'S7-wire.png');
  return notes;
});

// ── S8 Orbit + physics settle ──────────────────────────────────────────────
await scenario(page, 'S8', 'Orbit + physics settle', false, async () => {
  const notes = [];
  const canvas = await page.$('#c');
  const box = await canvas.boundingBox();
  const cx = box.x + box.width * 0.55;
  const cy = box.y + box.height * 0.45;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 160, cy + 20, { steps: 16 });
  await page.mouse.up();
  await sleep(300);
  const mid = await snap(page);
  notes.push(`post-orbit maxΩ=${mid.physics.maxOmega.toFixed(3)}`);

  // Let settle
  await sleep(2000);
  const end = await snap(page);
  notes.push(
    `settled maxΩ=${end.physics.maxOmega.toFixed(4)} KE=${end.physics.kineticEnergy.toExponential(2)} sleep=${end.physics.sleeping}/${end.physics.freeJoints}`,
  );
  if (end.physics.maxOmega > 0.5) {
    addFinding(
      'performance',
      'Physics not settling after orbit',
      `maxOmega=${end.physics.maxOmega} after 2s rest`,
      'S8',
    );
  }
  await shot(page, 'S8-orbit.png');

  // Soft: canvas pick near canopy (trunk is thin; center often hits background)
  await page.evaluate(() => window.__bonsai.setTool('inspect'));
  const pickAttempts = [
    [cx, cy - 80],
    [cx, cy - 40],
    [cx + 30, cy - 100],
    [cx - 20, cy - 60],
  ];
  let picked = null;
  for (const [px, py] of pickAttempts) {
    await page.mouse.click(px, py);
    await sleep(200);
    const afterPick = await snap(page);
    if (afterPick.selected) {
      picked = afterPick.selected;
      break;
    }
  }
  if (!picked) {
    addFinding(
      'playability',
      'Canvas raycast pick missed tree after several attempts',
      'Clicked near canopy/center; harness act() works. Thin pickables or headless GL may contribute — verify on real GPU.',
      'S8',
    );
    notes.push('canvas pick: miss');
  } else {
    notes.push(`canvas pick: ${picked}`);
  }
  return notes;
});

// ── S9 Save / restore ──────────────────────────────────────────────────────
await scenario(page, 'S9', 'Save and restore', true, async () => {
  const before = await snap(page);
  await page.evaluate(() => window.__bonsai.saveNow());
  const stored = await page.evaluate(() => localStorage.getItem('bonsai-en-autosave'));
  if (!stored || stored.length < 20) throw new Error('Autosave missing after saveNow');

  // Reload and expect restore
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitForHarness(page);
  await sleep(1500);
  const after = await snap(page);
  if (Math.abs(after.agePlantDays - before.agePlantDays) > 2) {
    throw new Error(
      `Age not restored (was ${before.agePlantDays}, got ${after.agePlantDays})`,
    );
  }
  if (Math.abs(after.nodeCount - before.nodeCount) > 2) {
    addFinding(
      'bug',
      'Node count changed after save reload',
      `${before.nodeCount} → ${after.nodeCount}`,
      'S9',
    );
  }
  return [
    `restored age≈${after.ageLabel}, nodes=${after.nodeCount}`,
  ];
});

// ── S10 Share ──────────────────────────────────────────────────────────────
await scenario(page, 'S10', 'Share hash', false, async () => {
  const hash = await page.evaluate(() => window.__bonsai.getShareHash());
  if (!hash || !hash.startsWith('#s=')) {
    throw new Error(`Bad share hash: ${hash}`);
  }
  const s = await snap(page);
  // UI path
  await page.click('#btn-files');
  await sleep(200);
  await page.click('#btn-share');
  await sleep(400);
  const status = await page.evaluate(
    () => document.getElementById('status')?.textContent?.trim(),
  );
  // copyShareLink refuses URLs > MAX_SHARE_URL_LENGTH (24k; hash not sent to server)
  const MAX_SHARE_URL_LENGTH = 24_000;
  const fullUrlApprox = 80 + hash.length;
  if (fullUrlApprox > MAX_SHARE_URL_LENGTH) {
    addFinding(
      'playability',
      'Share link falls back to file download early',
      `At ~${s.nodeCount} nodes, hash length=${hash.length} (URL ≳${fullUrlApprox} > ${MAX_SHARE_URL_LENGTH}).`,
      'S10',
    );
  }
  // Soft note if status still shows fallback despite smaller hash (clipboard etc.)
  if (status && /too large for a share link/i.test(status) && fullUrlApprox <= MAX_SHARE_URL_LENGTH) {
    addFinding(
      'playability',
      'Share reported too-large despite URL under limit',
      `status="${status}", url≈${fullUrlApprox}`,
      'S10',
    );
  }
  return [`hashLen=${hash.length}, status="${status}", nodes=${s.nodeCount}`];
});

// ── S11 Export JSON ────────────────────────────────────────────────────────
await scenario(page, 'S11', 'Export JSON', true, async () => {
  const json = await page.evaluate(() => window.__bonsai.exportJson());
  if (!json || json.length < 50) throw new Error('exportJson empty');
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('exportJson not valid JSON');
  }
  if (parsed.schemaVersion !== 1 || !parsed.rootId) {
    throw new Error('export missing schema/root');
  }
  return [`bytes=${json.length}, nodes=${Object.keys(parsed.nodes || {}).length}`];
});

// ── S12 Stress / performance ───────────────────────────────────────────────
await scenario(page, 'S12', 'Stress growth performance', false, async () => {
  const notes = [];
  const samples = [];
  await page.evaluate(() => window.__bonsai.newSapling());
  await sleep(500);
  await page.evaluate(() => window.__bonsai.setSpeed('year'));
  for (let i = 0; i < 20; i++) {
    await sleep(400);
    const p = await getPerf(page);
    const s = await snap(page);
    samples.push({
      i,
      avgFrameMs: p.avgFrameMs,
      lastFrameMs: p.lastFrameMs,
      nodes: s.nodeCount,
      age: s.agePlantDays,
    });
  }
  await page.evaluate(() => window.__bonsai.setSpeed('pause'));
  await sleep(400);
  const final = await snap(page);
  const finalPerf = await getPerf(page);
  const med = median(samples.map((x) => x.avgFrameMs));
  notes.push(
    `nodes=${final.nodeCount}, age=${final.ageLabel}, medianAvgFrameMs=${med.toFixed(1)}, last=${finalPerf.lastFrameMs.toFixed(1)}`,
  );

  // Soft budgets under SwiftShader — relative flags only
  if (med > 50) {
    addFinding(
      'performance',
      'High median frame time under Years growth (SwiftShader)',
      `median avgFrameMs=${med.toFixed(1)} at ~${final.nodeCount} nodes`,
      'S12',
    );
  } else if (med > 33) {
    addFinding(
      'performance',
      'Elevated frame time under Years growth (SwiftShader)',
      `median avgFrameMs=${med.toFixed(1)} at ~${final.nodeCount} nodes — soft budget 33ms`,
      'S12',
    );
  }

  if (final.nodeCount > 400) {
    addFinding(
      'playability',
      'Very large node counts after short Years stress',
      `nodeCount=${final.nodeCount} after ~8s years — may overwhelm mobile`,
      'S12',
    );
  }

  // Persist samples on result via notes
  notes.push(`samplePeakNodes=${Math.max(...samples.map((x) => x.nodes))}`);
  await shot(page, 'S12-stress.png');
  // attach full samples to last result after push — store in notes as JSON snippet
  notes.push(`samples=${JSON.stringify(samples.slice(-3))}`);
  return notes;
});

// ── S13 Mobile viewport ────────────────────────────────────────────────────
await scenario(page, 'S13', 'Mobile viewport', false, async () => {
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.evaluate(() => window.__bonsai.newSapling());
  await sleep(600);
  await page.click('button[data-tool="prune"]');
  const pruneActive = await page.evaluate(() =>
    document.querySelector('[data-tool="prune"]')?.classList.contains('active'),
  );
  if (!pruneActive) throw new Error('Mobile prune button not active');
  await page.click('button[data-speed="year"]');
  await sleep(1500);
  await page.click('button[data-speed="0"]');
  const s = await snap(page);
  // Files menu
  await page.click('#btn-files');
  await sleep(200);
  const menuOpen = await page.evaluate(
    () => !document.getElementById('files-menu')?.hidden,
  );
  if (!menuOpen) {
    addFinding('bug', 'Files menu did not open on mobile', '', 'S13');
  }
  await shot(page, 'S13-mobile.png');
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  return [`age=${s.ageLabel}, nodes=${s.nodeCount}, menuOpen=${menuOpen}`];
});

// ── S14 Sumi + mute ────────────────────────────────────────────────────────
await scenario(page, 'S14', 'Sumi + mute toggles', false, async () => {
  await page.evaluate(() => {
    window.__bonsai.setSumiChallenge(true);
    window.__bonsai.setMuted(true);
  });
  await sleep(300);
  await page.evaluate(() => {
    window.__bonsai.setSumiChallenge(false);
    window.__bonsai.setMuted(false);
  });
  await shot(page, 'S14-sumi.png');
  return ['toggled sumi + mute via harness'];
});

// ── Collect late errors ────────────────────────────────────────────────────
if (pageErrors.length) {
  for (const e of pageErrors.slice(0, 8)) {
    addFinding('blocker', 'Page error during playtest', e);
  }
  hardFail = true;
}
if (consoleErrors.length) {
  const unique = [...new Set(consoleErrors)]
    .filter((e) => !/favicon/i.test(e))
    .slice(0, 10);
  for (const e of unique) {
    addFinding('bug', 'Console error', e);
  }
}

await browser.close();

// ── Write reports ──────────────────────────────────────────────────────────
const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok).length;
const report = {
  generatedAt: new Date().toISOString(),
  baseUrl: BASE_URL,
  hardFail,
  summary: {
    scenarios: results.length,
    passed,
    failed,
    findings: findings.length,
    pageErrors: pageErrors.length,
    consoleErrors: consoleErrors.length,
  },
  results,
  findings,
  pageErrors,
  consoleErrors: [...new Set(consoleErrors)],
};

fs.writeFileSync(
  path.join(REPORT_DIR, 'latest.json'),
  JSON.stringify(report, null, 2),
);

const md = buildMarkdown(report);
fs.writeFileSync(path.join(REPORT_DIR, 'latest.md'), md);

console.log('\n══════════════════════════════════════');
console.log(
  `Playtest ${hardFail || failed ? 'FAILED' : 'OK'}: ${passed}/${results.length} scenarios, ${findings.length} findings`,
);
console.log(`Report: playtest-reports/latest.md`);
console.log('══════════════════════════════════════\n');

process.exit(hardFail || failed ? 1 : 0);

function buildMarkdown(report) {
  const lines = [];
  lines.push('# Bonsai-en playtest report');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`URL: ${report.baseUrl}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(
    `| Scenarios | Passed | Failed | Findings | Hard fail |`,
  );
  lines.push(`|-----------|--------|--------|----------|-----------|`);
  lines.push(
    `| ${report.summary.scenarios} | ${report.summary.passed} | ${report.summary.failed} | ${report.summary.findings} | ${report.hardFail} |`,
  );
  lines.push('');
  lines.push(
    '> Perf samples are under headless **SwiftShader** — relative only, not product GPU.',
  );
  lines.push('');
  lines.push('## Scenarios');
  lines.push('');
  lines.push('| ID | Name | Result | ms | Notes |');
  lines.push('|----|------|--------|----|-------|');
  for (const r of report.results) {
    const note = (r.notes || []).join('; ').replace(/\|/g, '/').slice(0, 120);
    lines.push(
      `| ${r.id} | ${r.name} | ${r.ok ? '✓' : '✗'} | ${r.durationMs} | ${note} |`,
    );
  }
  lines.push('');
  lines.push('## Findings');
  lines.push('');
  if (!report.findings.length) {
    lines.push('_No findings recorded._');
  } else {
    for (const f of report.findings) {
      lines.push(`### ${f.id} · ${f.severity}${f.scenario ? ` · ${f.scenario}` : ''}`);
      lines.push('');
      lines.push(`**${f.title}**`);
      lines.push('');
      if (f.detail) lines.push(f.detail);
      lines.push('');
    }
  }
  lines.push('## How to re-run');
  lines.push('');
  lines.push('```bash');
  lines.push('npm run dev   # terminal A');
  lines.push('npm run playtest');
  lines.push('```');
  lines.push('');
  return lines.join('\n');
}
