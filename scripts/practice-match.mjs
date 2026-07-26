/**
 * Practice-mode deep dive: enable sumi guide, train with tools, score match.
 *
 * Usage (dev server up):
 *   BONSAI_URL=http://localhost:5173 node scripts/practice-match.mjs
 *
 * Outputs:
 *   playtest-reports/practice/*.png
 *   playtest-reports/practice/report.json
 *   playtest-reports/practice/report.md
 */
import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(ROOT, 'playtest-reports/practice');
const BASE_URL = process.env.BONSAI_URL || 'http://localhost:5173/';
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
page.on('dialog', async (d) => {
  try {
    await d.accept();
  } catch {
    /* ignore */
  }
});

await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(
  () =>
    typeof window.__bonsai?.getPracticeScore === 'function' &&
    typeof window.__bonsai?.act === 'function',
  { timeout: 30000 },
);
await sleep(2500);

const log = [];
function note(msg) {
  console.log(msg);
  log.push(msg);
}

async function score() {
  return page.evaluate(() => window.__bonsai.getPracticeScore());
}

async function snap(name) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, type: 'png' });
  return file;
}

async function frontOrtho(name) {
  await page.evaluate(() => {
    window.__bonsai.setUiVisible(false);
    window.__bonsai.setView('front');
  });
  await sleep(400);
  await snap(name);
  await page.evaluate(() => {
    window.__bonsai.setView('default');
    window.__bonsai.setUiVisible(true);
  });
  await sleep(300);
}

// ── 0. Fresh sapling + practice on ─────────────────────────────────────────
await page.evaluate(() => {
  window.__bonsai.newSapling();
  window.__bonsai.setSumiChallenge(true);
});
await sleep(1200);
const s0 = await score();
note(`T0 sapling+practice: ${JSON.stringify(s0)}`);
await snap('00-practice-on-sapling.png');
await frontOrtho('00-front-sapling.png');

// ── 1. Grow without training ───────────────────────────────────────────────
await page.evaluate(() => window.__bonsai.setSpeed('year'));
await sleep(3500);
await page.evaluate(() => window.__bonsai.setSpeed('pause'));
await sleep(600);
const s1 = await score();
note(`T1 after wild Years: ${JSON.stringify(s1)}`);
await snap('01-wild-grown.png');
await frontOrtho('01-front-wild.png');

// ── 2. Train: prune overflow tips (outside target envelope) ───────────────
const pruneResult = await page.evaluate(() => {
  const nodes = window.__bonsai.listNodes();
  const snap = window.__bonsai.getSnapshot();
  // Outside soft envelope: |x| large, or above target height band
  const TARGET_H = 0.255;
  const leaves = nodes.filter((n) => n.living && n.isLeaf && n.parentId);
  leaves.sort((a, b) => {
    const oa = Math.abs(a.tipX) + Math.max(0, a.tipY - TARGET_H);
    const ob = Math.abs(b.tipX) + Math.max(0, b.tipY - TARGET_H);
    return ob - oa;
  });
  let pruned = 0;
  const msgs = [];
  for (const leaf of leaves) {
    if (pruned >= 10) break;
    const outside =
      Math.abs(leaf.tipX) > 0.042 ||
      leaf.tipY > TARGET_H * 1.08 ||
      Math.hypot(leaf.tipX, leaf.tipZ) > 0.055;
    if (!outside) continue;
    const r = window.__bonsai.act('prune', leaf.id);
    if (r.ok) {
      pruned++;
      msgs.push(leaf.id);
    }
  }
  return { pruned, msgs, nodesBefore: snap.nodeCount };
});
note(`T2 prune pass: ${JSON.stringify(pruneResult)}`);
await sleep(500);
const s2 = await score();
note(`T2 after prune: ${JSON.stringify(s2)}`);
await snap('02-after-prune.png');

// ── 3. Wire longest mid-stem nodes toward S-curve (alternate bend) ─────────
const wireResult = await page.evaluate(() => {
  const nodes = window.__bonsai.listNodes();
  // Prefer stem nodes near center (low |x|), ascending height — S-curve bends
  const candidates = nodes
    .filter(
      (n) =>
        n.living &&
        n.parentId &&
        !n.hasWire &&
        n.length > 0.01 &&
        Math.abs(n.tipX) < 0.035 &&
        n.tipY > 0.04 &&
        n.tipY < 0.22,
    )
    .sort((a, b) => a.tipY - b.tipY)
    .slice(0, 6);
  // Alternate left/right lean matching PRACTICE_STEM S-curve
  const dirs = [
    [-0.25, 0.95, 0.02],
    [0.32, 0.92, 0.02],
    [-0.35, 0.9, 0.03],
    [0.3, 0.92, -0.02],
    [-0.22, 0.94, 0.01],
    [0.12, 0.98, 0],
  ];
  const applied = [];
  candidates.forEach((n, i) => {
    const w = window.__bonsai.act('wire', n.id);
    if (w.ok) {
      window.__bonsai.bend(n.id, dirs[i % dirs.length]);
      applied.push(n.id);
    }
  });
  return { applied };
});
note(`T3 wire/bend: ${JSON.stringify(wireResult)}`);
// Let wire set a bit
await page.evaluate(() => window.__bonsai.setSpeed('month'));
await sleep(3000);
await page.evaluate(() => window.__bonsai.setSpeed('pause'));
await sleep(500);
const s3 = await score();
note(`T3 after wire set: ${JSON.stringify(s3)}`);
await snap('03-after-wire.png');
await frontOrtho('03-front-wired.png');

// ── 4. Second prune + grow carefully ───────────────────────────────────────
await page.evaluate(() => {
  const nodes = window.__bonsai.listNodes();
  const leaves = nodes
    .filter((n) => n.living && n.isLeaf && n.parentId && n.length > 0.012)
    .sort((a, b) => b.length - a.length)
    .slice(0, 6);
  for (const leaf of leaves) {
    window.__bonsai.act('prune', leaf.id);
  }
});
await page.evaluate(() => window.__bonsai.setSpeed('week'));
await sleep(2500);
await page.evaluate(() => window.__bonsai.setSpeed('pause'));
await sleep(500);
const s4 = await score();
note(`T4 after second prune+week: ${JSON.stringify(s4)}`);
await snap('04-trained.png');
await frontOrtho('04-front-trained.png');

// ── 5. Score-guided prune: remove tips that hurt overflow most ─────────────
await page.evaluate(() => {
  const TARGET_H = 0.255;
  for (let round = 0; round < 4; round++) {
    const nodes = window.__bonsai.listNodes();
    const leaves = nodes
      .filter((n) => n.living && n.isLeaf && n.parentId)
      .map((n) => ({
        ...n,
        overflowKey:
          Math.max(0, Math.abs(n.tipX) - 0.035) * 2 +
          Math.max(0, n.tipY - TARGET_H) * 3 +
          Math.max(0, Math.hypot(n.tipX, n.tipZ) - 0.05),
      }))
      .filter((n) => n.overflowKey > 0.008)
      .sort((a, b) => b.overflowKey - a.overflowKey);
    for (const leaf of leaves.slice(0, 4)) {
      window.__bonsai.act('prune', leaf.id);
    }
  }
});
await sleep(600);
const s5 = await score();
note(`T5 aggressive prune: ${JSON.stringify(s5)}`);
await snap('05-aggressive.png');
await frontOrtho('05-front-aggressive.png');

// ── Ortho front with UI for product view ───────────────────────────────────
await page.evaluate(() => {
  window.__bonsai.setView('default');
  window.__bonsai.setUiVisible(true);
  window.__bonsai.setSumiChallenge(true);
});
await sleep(400);
await snap('06-final-product.png');

const series = [
  { t: 'T0 sapling', ...s0 },
  { t: 'T1 wild Years', ...s1 },
  { t: 'T2 after prune', ...s2 },
  { t: 'T3 after wire', ...s3 },
  { t: 'T4 trained', ...s4 },
  { t: 'T5 aggressive', ...s5 },
];

const best = series.reduce((a, b) => (b.score > a.score ? b : a));
const delta = s5.score - s0.score;

const report = {
  generatedAt: new Date().toISOString(),
  baseUrl: BASE_URL,
  series,
  best,
  deltaT0toT5: delta,
  log,
  interpretation: {
    canImproveWithTools: delta > 0.02 || s5.score > s1.score,
    reachedClose: series.some((s) => s.grade === 'close' || s.grade === 'match'),
    reachedMatch: series.some((s) => s.grade === 'match'),
    notes: [
      'Score = 0.28·containment + 0.26·bandFit + 0.18·centerline + 0.14·height + 0.14·presence',
      'Grades: far <0.45, forming <0.72, close <0.82, match ≥0.82',
      'Target: ~25cm informal-upright (moyogi) pad in the front plane',
    ],
  },
};

fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));

const md = [];
md.push('# Practice mode match report');
md.push('');
md.push(`Generated: ${report.generatedAt}`);
md.push('');
md.push('## Score series');
md.push('');
md.push('| Step | Grade | Score | Contain | Band fit | Overflow | Centerline RMSE | Height ratio |');
md.push('|------|-------|-------|---------|----------|----------|-----------------|--------------|');
for (const s of series) {
  md.push(
    `| ${s.t} | ${s.grade} | ${s.score.toFixed(3)} | ${s.iou.toFixed(3)} | ${(s.bandFit ?? s.coverage).toFixed(3)} | ${s.overflow.toFixed(3)} | ${s.centerlineRmse.toFixed(4)} | ${s.heightRatio.toFixed(2)} |`,
  );
}
md.push('');
md.push(`**Best:** ${best.t} · ${best.grade} · ${best.score.toFixed(3)}`);
md.push('');
md.push(`**Δ score T0→T5:** ${delta.toFixed(3)}`);
md.push('');
md.push('## Interpretation');
md.push('');
md.push(`- Tools improved score: **${report.interpretation.canImproveWithTools}**`);
md.push(`- Reached close/match: **${report.interpretation.reachedClose}**`);
md.push(`- Reached match (≥0.78): **${report.interpretation.reachedMatch}**`);
md.push('');
for (const n of report.interpretation.notes) md.push(`- ${n}`);
md.push('');
md.push('## Log');
md.push('```');
md.push(log.join('\n'));
md.push('```');
fs.writeFileSync(path.join(OUT, 'report.md'), md.join('\n'));

console.log('\n══ Practice match ══');
console.log(`Best ${best.grade} ${best.score.toFixed(3)} @ ${best.t}`);
console.log(`Δ T0→T5 ${delta.toFixed(3)} · close? ${report.interpretation.reachedClose}`);
console.log(`Wrote ${OUT}/report.md`);

await browser.close();
process.exit(0);
