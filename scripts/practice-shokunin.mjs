/**
 * Shokunin (craftsman) path for sumi Practice mode.
 *
 * Disciplined sequence — NOT the brute-force grow→prune-longest→wire-random
 * hack of practice-match.mjs.
 *
 *   SK0  Front + practice on (score T0)
 *   SK1  Structural prune by envelope / overflow (no bulk Years yet)
 *   SK2  Wire primary trunk toward PRACTICE_STEM
 *   SK3  Plant-time for wire set (month)
 *   SK4  Seasonal grow → pinch / light prune loops
 *   SK5  Rest, screenshots, final grade + report
 *
 * Usage (dev server up):
 *   npm run practice:shokunin
 *   BONSAI_URL=http://localhost:5173 node scripts/practice-shokunin.mjs
 *
 * Outputs (gitignored):
 *   playtest-reports/practice/shokunin-*.png
 *   playtest-reports/practice/shokunin-report.json
 *   playtest-reports/practice/shokunin-report.md
 *
 * Hard gates (exit 1):
 *   - page errors
 *   - best phase score < T0 + 0.05
 *
 * Soft gate (documented only):
 *   - final grade close / match
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

/** Mirror of src/sim/practice/target.ts PRACTICE_STEM (soil-local m). */
const PRACTICE_STEM = [
  [0.0, 0.0],
  [-0.008, 0.03],
  [0.014, 0.07],
  [-0.018, 0.11],
  [0.016, 0.155],
  [-0.01, 0.195],
  [0.0, 0.24],
];
const PRACTICE_HEIGHT = 0.255;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pageErrors = [];
const log = [];
function note(msg) {
  console.log(msg);
  log.push(msg);
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
// deviceScaleFactor 1 keeps soft-GL wall time sane for multi-year training
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
page.on('dialog', async (d) => {
  try {
    await d.accept();
  } catch {
    /* ignore */
  }
});
page.on('pageerror', (err) => {
  pageErrors.push(String(err.message || err));
  note(`PAGEERROR: ${err.message || err}`);
});

await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(
  () =>
    typeof window.__bonsai?.getPracticeScore === 'function' &&
    typeof window.__bonsai?.act === 'function' &&
    typeof window.__bonsai?.bend === 'function' &&
    typeof window.__bonsai?.newSapling === 'function',
  { timeout: 30000 },
);
await sleep(2500);

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
  await sleep(350);
  await snap(name);
  await page.evaluate(() => {
    window.__bonsai.setView('default');
    window.__bonsai.setPhysicsFrozen(false);
    window.__bonsai.setUiVisible(true);
  });
  await sleep(250);
}

// ── SK0 — Front + practice on ─────────────────────────────────────────────
note('══ SK0 Front + practice on ══');
await page.evaluate(() => {
  window.__bonsai.newSapling();
  window.__bonsai.setSumiChallenge(true);
  window.__bonsai.setView('front');
});
await sleep(1200);
const s0 = await score();
note(`SK0 T0 sapling+practice: ${JSON.stringify(s0)}`);
await frontOrtho('shokunin-SK0-front.png');

// ── SK1 — Structural prune by overflow / envelope (no bulk Years) ─────────
note('══ SK1 Structural prune ══');
const sk1 = await page.evaluate(
  ({ practiceHeight, halfWidthSamples }) => {
    const nodes = window.__bonsai.listNodes();
    function halfW(y) {
      // Reconstruct from samples passed in (simple ladder)
      if (y < 0.03) return halfWidthSamples[0];
      if (y < 0.08) return halfWidthSamples[1];
      if (y < 0.13) return halfWidthSamples[2];
      if (y < 0.18) return halfWidthSamples[3];
      if (y < 0.22) return halfWidthSamples[4];
      return halfWidthSamples[5];
    }
    const leaves = nodes.filter((n) => n.living && n.isLeaf && n.parentId);
    const ranked = leaves
      .map((n) => {
        const hw = halfW(n.tipY);
        const lateralOver = Math.max(0, Math.abs(n.tipX) - hw);
        const heightOver = Math.max(0, n.tipY - practiceHeight);
        const depth = Math.max(0, Math.abs(n.tipZ) - 0.018);
        const outside =
          Math.abs(n.tipX) > hw * 1.05 ||
          n.tipY > practiceHeight * 1.02 ||
          Math.hypot(n.tipX, n.tipZ) > hw * 1.35;
        const lowFat =
          n.tipY < practiceHeight * 0.34 && Math.abs(n.tipX) > hw * 0.85
            ? 0.025
            : 0;
        const overflowKey =
          (outside ? 0.04 : 0) +
          lateralOver * 2.2 +
          heightOver * 3.0 +
          depth * 1.6 +
          lowFat;
        return { id: n.id, overflowKey, tipX: n.tipX, tipY: n.tipY };
      })
      .filter((n) => n.overflowKey > 0.004)
      .sort((a, b) => b.overflowKey - a.overflowKey);

    let pruned = 0;
    const msgs = [];
    for (const leaf of ranked) {
      if (pruned >= 10) break;
      const r = window.__bonsai.act('prune', leaf.id);
      if (r.ok) {
        pruned++;
        msgs.push(leaf.id);
      }
    }
    return { pruned, considered: ranked.length, topKeys: ranked.slice(0, 5).map((r) => r.overflowKey) };
  },
  {
    practiceHeight: PRACTICE_HEIGHT,
    halfWidthSamples: [0.01, 0.028, 0.048, 0.055, 0.04, 0.02],
  },
);
note(`SK1 prune: ${JSON.stringify(sk1)}`);
await sleep(500);
const s1 = await score();
note(`SK1 after structural prune: ${JSON.stringify(s1)}`);
await snap('shokunin-SK1-structure.png');

// Soft SK1 checks (logged, not hard-fail)
if (s1.overflow > s0.overflow + 0.05) {
  note(`SOFT: SK1 overflow rose (${s0.overflow.toFixed(3)} → ${s1.overflow.toFixed(3)})`);
}
if (s1.iou + 0.02 < s0.iou) {
  note(`SOFT: SK1 containment dipped (${s0.iou.toFixed(3)} → ${s1.iou.toFixed(3)})`);
}

// ── SK2 — Wire primary trunk toward PRACTICE_STEM ─────────────────────────
note('══ SK2 Trunk wire ══');
// Craftsman only wires when the line needs it — a tight centerline gets a light S
const sk2PreRmse = s1.centerlineRmse;
const sk2 = await page.evaluate(
  ({ stem, preRmse }) => {
    const nodes = window.__bonsai.listNodes();
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));

    // Apex: tallest living node near the front axis
    const apexCandidates = nodes
      .filter(
        (n) =>
          n.living &&
          Math.abs(n.tipX) < 0.045 &&
          Math.abs(n.tipZ) < 0.05,
      )
      .sort((a, b) => b.tipY - a.tipY);
    const apex = apexCandidates[0];
    if (!apex) return { applied: [], reason: 'no apex' };

    // Walk parent chain → primary stem base→apex
    const chainRev = [];
    let cur = apex;
    let guard = 0;
    while (cur && cur.parentId && guard++ < 200) {
      chainRev.push(cur);
      cur = byId[cur.parentId];
    }
    const chain = chainRev.reverse();

    function stemDirAt(y) {
      let bestI = 0;
      let bestDist = Infinity;
      for (let i = 0; i < stem.length - 1; i++) {
        const y0 = stem[i][1];
        const y1 = stem[i + 1][1];
        if (y >= y0 - 1e-6 && y <= y1 + 1e-6) {
          bestI = i;
          break;
        }
        const mid = (y0 + y1) / 2;
        const d = Math.abs(mid - y);
        if (d < bestDist) {
          bestDist = d;
          bestI = i;
        }
      }
      const [x0, y0] = stem[bestI];
      const [x1, y1] = stem[bestI + 1];
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len = Math.hypot(dx, dy) || 1;
      return [dx / len, dy / len, 0.03 * Math.sign(dx || 1)];
    }

    const candidates = chain.filter(
      (n) =>
        n.living &&
        n.parentId &&
        !n.hasWire &&
        n.length > 0.01 &&
        n.tipY > 0.035 &&
        n.tipY < 0.20,
    );

    // Craftsman: small corrections. Tight line → fewer / softer bends.
    const maxWires =
      preRmse < 0.012
        ? Math.min(2, candidates.length)
        : Math.min(4, Math.max(2, Math.ceil(candidates.length / 2)));
    // Blend current wood direction with PRACTICE_STEM (never hard-snap)
    const stemBlend = preRmse < 0.012 ? 0.18 : 0.4;

    const applied = [];
    const step = Math.max(1, Math.floor(candidates.length / Math.max(1, maxWires)));
    for (let i = 0; i < candidates.length && applied.length < maxWires; i += step) {
      const n = candidates[i];
      const w = window.__bonsai.act('wire', n.id);
      if (!w.ok) continue;

      const parent = byId[n.parentId];
      let cx = 0;
      let cy = 1;
      let cz = 0;
      if (parent) {
        const dx = n.tipX - parent.tipX;
        const dy = n.tipY - parent.tipY;
        const dz = n.tipZ - parent.tipZ;
        const L = Math.hypot(dx, dy, dz) || 1;
        cx = dx / L;
        cy = dy / L;
        cz = dz / L;
      }
      const raw = stemDirAt(n.tipY);
      const b = stemBlend;
      const dir = [
        cx * (1 - b) + raw[0] * b,
        cy * (1 - b) + raw[1] * b,
        cz * (1 - b) + raw[2] * b * 0.5,
      ];
      const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
      const unit = [dir[0] / len, dir[1] / len, dir[2] / len];
      window.__bonsai.bend(n.id, unit);
      applied.push({ id: n.id, tipY: n.tipY, dir: unit });
    }
    return {
      applied: applied.map((a) => a.id),
      chainLen: chain.length,
      candidateCount: candidates.length,
      maxWires,
      stemBlend,
      preRmse,
    };
  },
  { stem: PRACTICE_STEM, preRmse: sk2PreRmse },
);
note(`SK2 wire: ${JSON.stringify(sk2)}`);
await sleep(400);
const s2 = await score();
note(`SK2 after trunk wire: ${JSON.stringify(s2)}`);
await snap('shokunin-SK2-wired.png');

// ── SK3 — Set time (month) so wire lignifies ──────────────────────────────
note('══ SK3 Wire set time ══');
const wireBefore = await page.evaluate(() => {
  return window.__bonsai
    .listNodes()
    .filter((n) => n.hasWire)
    .map((n) => ({ id: n.id, set: n.wireSetAmount }));
});
await page.evaluate(() => {
  window.__bonsai.setView('default');
  window.__bonsai.setPhysicsFrozen(false);
  window.__bonsai.setSpeed('month');
});
await sleep(3000);
await page.evaluate(() => window.__bonsai.setSpeed('pause'));
await sleep(400);
const wireAfter = await page.evaluate(() => {
  return window.__bonsai
    .listNodes()
    .filter((n) => n.hasWire)
    .map((n) => ({ id: n.id, set: n.wireSetAmount }));
});
const setDelta =
  wireAfter.reduce((s, n) => s + (n.set ?? 0), 0) -
  wireBefore.reduce((s, n) => s + (n.set ?? 0), 0);
note(
  `SK3 wire set Δsum=${setDelta.toFixed(3)} before=${JSON.stringify(wireBefore)} after=${JSON.stringify(wireAfter)}`,
);
const s3 = await score();
note(`SK3 after set: ${JSON.stringify(s3)}`);
await snap('shokunin-SK3-set.png');

// ── SK4 — Seasonal grow + pinch / prune loops ─────────────────────────────
note('══ SK4 Pad flush cycles ══');
const sk4Loops = [];
// Seasonal cycles: early loops grow freely into the pad; later loops
// pinch/prune only clear envelope overflow (never length-ranked mass clear).
for (let loop = 0; loop < 4; loop++) {
  const pre = await score();
  const short = pre.heightRatio < 0.88;
  // First two cycles: pure flush (structure already set) — no cuts
  const growOnly = loop < 2;

  await page.evaluate(() => {
    window.__bonsai.setView('default');
    window.__bonsai.setPhysicsFrozen(false);
    window.__bonsai.setSpeed('week');
  });
  await sleep(growOnly ? 1400 : 1000);
  await page.evaluate(() => window.__bonsai.setSpeed('year'));
  // ~2–3 plant-years while short; shorter once height is in band
  await sleep(growOnly || short ? 2200 : 1200);
  await page.evaluate(() => window.__bonsai.setSpeed('pause'));
  await sleep(350);

  let edit = { pinched: 0, pruned: 0, shortTree: short, growOnly };
  if (!growOnly) {
    edit = await page.evaluate(
      ({ practiceHeight, halfWidthSamples, loopIndex, shortTree }) => {
        const nodes = window.__bonsai.listNodes();
        function halfW(y) {
          if (y < 0.03) return halfWidthSamples[0];
          if (y < 0.08) return halfWidthSamples[1];
          if (y < 0.13) return halfWidthSamples[2];
          if (y < 0.18) return halfWidthSamples[3];
          if (y < 0.22) return halfWidthSamples[4];
          return halfWidthSamples[5];
        }

        let pinched = 0;
        let pruned = 0;

        const tips = nodes
          .filter((n) => n.living && n.isLeaf && n.parentId)
          .map((n) => {
            const hw = halfW(n.tipY);
            const overshoot =
              Math.max(0, n.tipY - practiceHeight * (shortTree ? 1.08 : 0.98)) *
                2 +
              Math.max(0, Math.abs(n.tipX) - hw * (shortTree ? 1.2 : 1.0)) +
              Math.max(0, Math.abs(n.tipZ) - 0.025);
            return { ...n, overshoot, hw };
          })
          .filter((n) => n.overshoot > (shortTree ? 0.015 : 0.006))
          .sort((a, b) => b.overshoot - a.overshoot);

        for (const tip of tips.slice(0, shortTree ? 3 : 5)) {
          const hardOutside =
            Math.abs(tip.tipX) > tip.hw * 1.3 ||
            tip.tipY > practiceHeight * 1.1;
          if (hardOutside) {
            const r = window.__bonsai.act('prune', tip.id);
            if (r.ok) pruned++;
          } else {
            const r = window.__bonsai.act('pinch', tip.id);
            if (r.ok) pinched++;
          }
        }

        // Envelope-only overflow pass
        const after = window.__bonsai.listNodes();
        const overflow = after
          .filter((n) => n.living && n.isLeaf && n.parentId)
          .map((n) => {
            const hw = halfW(n.tipY);
            const key =
              Math.max(0, Math.abs(n.tipX) - hw) * 2.2 +
              Math.max(0, n.tipY - practiceHeight) * 3 +
              Math.max(0, Math.abs(n.tipZ) - 0.022) * 1.5;
            return { id: n.id, key };
          })
          .filter((n) => n.key > 0.006)
          .sort((a, b) => b.key - a.key);
        for (const leaf of overflow.slice(0, 2 + Math.floor(loopIndex / 2))) {
          const r = window.__bonsai.act('prune', leaf.id);
          if (r.ok) pruned++;
        }

        return { pinched, pruned, shortTree, growOnly: false };
      },
      {
        practiceHeight: PRACTICE_HEIGHT,
        halfWidthSamples: [0.01, 0.028, 0.048, 0.055, 0.04, 0.02],
        loopIndex: loop,
        shortTree: short,
      },
    );
  }
  await sleep(400);
  const sl = await score();
  sk4Loops.push({
    loop: loop + 1,
    ...edit,
    score: sl.score,
    grade: sl.grade,
    heightRatio: sl.heightRatio,
  });
  note(
    `SK4 loop ${loop + 1}: ${JSON.stringify({
      ...edit,
      score: sl.score,
      grade: sl.grade,
      heightRatio: sl.heightRatio,
    })}`,
  );
  // One product snap per loop (skip extra ortho mid-loop for wall time)
  await snap(`shokunin-SK4-loop${loop + 1}.png`);
}
const s4 = await score();
note(`SK4 after pad cycles: ${JSON.stringify(s4)}`);
await frontOrtho('shokunin-SK4-front.png');

// ── SK5 — Rest, optional unwire, final grades ─────────────────────────────
note('══ SK5 Rest ══');
const unwireResult = await page.evaluate(() => {
  const wired = window.__bonsai
    .listNodes()
    .filter((n) => n.hasWire && (n.wireSetAmount ?? 0) > 0.55);
  let removed = 0;
  for (const n of wired) {
    const r = window.__bonsai.act('unwire', n.id);
    if (r.ok) removed++;
  }
  return { removed, considered: wired.length };
});
note(`SK5 unwire set wood: ${JSON.stringify(unwireResult)}`);
await page.evaluate(() => window.__bonsai.setSpeed('pause'));
await sleep(600);

// Quiet final prune if a single bar remains outside
await page.evaluate(({ practiceHeight }) => {
  const nodes = window.__bonsai.listNodes();
  const bars = nodes
    .filter((n) => n.living && n.isLeaf && n.parentId)
    .map((n) => ({
      id: n.id,
      key:
        Math.max(0, Math.abs(n.tipX) - 0.05) * 2 +
        Math.max(0, n.tipY - practiceHeight) * 3,
    }))
    .filter((n) => n.key > 0.015)
    .sort((a, b) => b.key - a.key)
    .slice(0, 2);
  for (const b of bars) window.__bonsai.act('prune', b.id);
}, { practiceHeight: PRACTICE_HEIGHT });
await sleep(400);

const s5 = await score();
note(`SK5 final: ${JSON.stringify(s5)}`);
await page.evaluate(() => {
  window.__bonsai.setView('front');
  window.__bonsai.setUiVisible(false);
  window.__bonsai.setSumiChallenge(true);
});
await sleep(400);
await snap('shokunin-SK5-front.png');
await page.evaluate(() => {
  window.__bonsai.setView('default');
  window.__bonsai.setUiVisible(true);
});
await sleep(400);
await snap('shokunin-SK5-product.png');

// ── Report ────────────────────────────────────────────────────────────────
const series = [
  { id: 'SK0', t: 'SK0 sapling + practice', ...s0 },
  { id: 'SK1', t: 'SK1 structural prune', ...s1 },
  { id: 'SK2', t: 'SK2 trunk wire', ...s2 },
  { id: 'SK3', t: 'SK3 wire set', ...s3 },
  { id: 'SK4', t: 'SK4 pad flush', ...s4 },
  { id: 'SK5', t: 'SK5 rest / final', ...s5 },
];

const best = series.reduce((a, b) => (b.score > a.score ? b : a));
const deltaBest = best.score - s0.score;
const deltaFinal = s5.score - s0.score;

const hardImprove = deltaBest >= 0.05;
const hardNoCrash = pageErrors.length === 0;
const softClose =
  series.some((s) => s.grade === 'close' || s.grade === 'match') ||
  s5.score >= 0.72;
const softMatch = series.some((s) => s.grade === 'match') || s5.score >= 0.82;

const report = {
  path: 'shokunin',
  generatedAt: new Date().toISOString(),
  baseUrl: BASE_URL,
  series,
  sk4Loops,
  best: { id: best.id, t: best.t, score: best.score, grade: best.grade },
  deltaBestVsT0: deltaBest,
  deltaFinalVsT0: deltaFinal,
  pageErrors,
  gates: {
    hard: {
      noPageErrors: hardNoCrash,
      scoreImprovesBy005: hardImprove,
    },
    soft: {
      finalCloseOrMatch: softClose,
      finalMatch: softMatch,
    },
  },
  log,
  notes: [
    'Shokunin maxim: cut first what is wrong, wire the line you keep, grow into the shape.',
    'Score = 0.28·containment + 0.26·bandFit + 0.18·centerline + 0.14·height + 0.14·presence',
    'Grades: far <0.45, forming <0.72, close <0.82, match ≥0.82',
    'Hard gates: no page errors; best phase score ≥ T0 + 0.05',
    'Soft gate: final grade close/match (track until consistently green)',
  ],
};

fs.writeFileSync(
  path.join(OUT, 'shokunin-report.json'),
  JSON.stringify(report, null, 2),
);

const md = [];
md.push('# Shokunin practice path report');
md.push('');
md.push(`Generated: ${report.generatedAt}`);
md.push('');
md.push('Craftsman sequence for the sumi **moyogi** ink target — structure before bulk growth, trunk line before pads.');
md.push('');
md.push('## Per-phase scores');
md.push('');
md.push(
  '| Phase | Grade | Score | Contain | Band fit | Overflow | Centerline RMSE | Height ratio |',
);
md.push(
  '|-------|-------|-------|---------|----------|----------|-----------------|--------------|',
);
for (const s of series) {
  md.push(
    `| ${s.t} | ${s.grade} | ${s.score.toFixed(3)} | ${s.iou.toFixed(3)} | ${(s.bandFit ?? s.coverage).toFixed(3)} | ${s.overflow.toFixed(3)} | ${s.centerlineRmse.toFixed(4)} | ${s.heightRatio.toFixed(2)} |`,
  );
}
md.push('');
md.push(
  `**Best:** ${best.t} · ${best.grade} · ${best.score.toFixed(3)} (Δ vs T0: ${deltaBest >= 0 ? '+' : ''}${deltaBest.toFixed(3)})`,
);
md.push('');
md.push(
  `**Final (SK5):** ${s5.grade} · ${s5.score.toFixed(3)} (Δ vs T0: ${deltaFinal >= 0 ? '+' : ''}${deltaFinal.toFixed(3)})`,
);
md.push('');
md.push('## SK4 pad cycles');
md.push('');
if (sk4Loops.length) {
  md.push('| Loop | Pinched | Pruned | Score | Grade |');
  md.push('|------|---------|--------|-------|-------|');
  for (const l of sk4Loops) {
    md.push(
      `| ${l.loop} | ${l.pinched} | ${l.pruned} | ${l.score.toFixed(3)} | ${l.grade} |`,
    );
  }
  md.push('');
}
md.push('## Gates');
md.push('');
md.push('| Gate | Severity | Result |');
md.push('|------|----------|--------|');
md.push(
  `| No page errors | **Hard** | ${hardNoCrash ? 'PASS' : 'FAIL'} (${pageErrors.length} errors) |`,
);
md.push(
  `| Best score ≥ T0 + 0.05 | **Hard** | ${hardImprove ? 'PASS' : 'FAIL'} (Δ ${deltaBest.toFixed(3)}) |`,
);
md.push(
  `| Final close/match | Soft | ${softClose ? 'PASS' : 'pending'} (final ${s5.grade} ${s5.score.toFixed(3)}) |`,
);
md.push(
  `| Final match (≥0.82) | Stretch | ${softMatch ? 'PASS' : 'pending'} |`,
);
md.push('');
md.push('## Screenshots');
md.push('');
md.push('- `shokunin-SK0-front.png`');
md.push('- `shokunin-SK1-structure.png`');
md.push('- `shokunin-SK2-wired.png`');
md.push('- `shokunin-SK3-set.png`');
md.push('- `shokunin-SK4-loop1.png` … `shokunin-SK4-front.png`');
md.push('- `shokunin-SK5-front.png` / `shokunin-SK5-product.png`');
md.push('');
md.push('## Notes');
md.push('');
for (const n of report.notes) md.push(`- ${n}`);
md.push('');
md.push('## Log');
md.push('```');
md.push(log.join('\n'));
md.push('```');
fs.writeFileSync(path.join(OUT, 'shokunin-report.md'), md.join('\n'));

console.log('\n══ Shokunin practice ══');
console.log(`Best ${best.grade} ${best.score.toFixed(3)} @ ${best.t} (ΔT0 ${deltaBest.toFixed(3)})`);
console.log(`Final ${s5.grade} ${s5.score.toFixed(3)} · close? ${softClose} · match? ${softMatch}`);
console.log(
  `Hard gates: noError=${hardNoCrash} improve=${hardImprove} · Wrote ${OUT}/shokunin-report.md`,
);

await browser.close();

const hardPass = hardNoCrash && hardImprove;
process.exit(hardPass ? 0 : 1);
