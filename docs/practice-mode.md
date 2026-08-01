# Practice mode deep dive

**Issue:** #36 · default-on UX: #52  
**Date:** 2026-07-26  

## What practice mode is

**Practice is the default play mode.** A **sumi ink silhouette** (soft fill + outline + stem line) of a classic **informal upright (moyogi)** target is visible on cold start, with live grade feedback. Geometry is shared between:

| Layer | File |
|-------|------|
| Target coordinates (soil-local m) | `src/sim/practice/target.ts` |
| Quantitative score | `src/sim/practice/score.ts` |
| Visual ghost | `src/render/sumi.ts` |
| Live HUD + harness | `Game.getPracticeScore()`, `window.__bonsai.getPracticeScore()` |
| Mode preference | `localStorage` key `bonsai-en:mode` = `practice` \| `sandbox` |
| Reference plates (licenses + rationale) | [`docs/refs/sumi/`](./refs/sumi/README.md) |

| Control | Behavior |
|---------|----------|
| Default / first visit | **Practice** — ghost + grade (status e.g. `Practice · forming 68`); soft-snaps play camera to **front viewing face** |
| `⋯ → Free train` | Sandbox — hide ghost, stop grade thrash; tools unchanged; front lock cleared |
| `⋯ → Practice` | Restore ghost + scoring + soft front snap (status `Viewing face`) |
| `⋯ → Lock front` | Practice only — disable orbit rotate + snap to front so score and eyes stay aligned |
| Off-axis (unlocked) | Quiet hint: “Score is front silhouette · Lock front in ⋯” |
| Preference | Survives reload; share/import keep last user mode |
| First-run hint | “Match the ink · prune outside · wire the trunk · grow into the pad” |
| Harness | `setFrontLock(bool)`, `isFrontLock()`, `snapToFrontFace()`; ortho `setView('front')` unchanged |
| Path checklist (#70) | Quiet collapsible **Path** steps in Practice only (hidden in Free train). Advisory — no tool locks. Tap step → status hint. Soft checks from orbit / prune / trunk wire / set / Season·Mo / Still. |

**Art grounding (#53):** stem S-curve and cloud envelope are tuned from CC moyogi diagrams/photos plus original ink plates (not a freehand diamond). Ink hierarchy is stem > outline > fill so the ghost stays quiet against living wood.

## Does it make sense?

### Yes (after this work)

1. **Target scale** matches a ~1–2 year training sapling (~25 cm tall, pot-width pad).
2. **Visual guide** is readable in front ortho and product view (faint cloud envelope + S-curve stem).
3. **Score** tracks what you see: wild laterals raise overflow; prune pulls material inside; short trees score lower on height/band fill.
4. **Tools matter:** prune/wire/grow can move the score (~+0.10 in the automated playthrough). Containment improves when strays are cut.

### Gaps / caveats

| Issue | Detail |
|-------|--------|
| **Not a filled “win” condition yet** | Automated train peaked **forming ~0.68**, best runs earlier hit **close ~0.75**. **Match (≥0.82)** needs denser pad mass + trunk line, not only pruning sticks. |
| **Wire is a double-edged tool** | Bending improved band fit / containment in some steps but **worsened centerline RMSE** (first-child stem path ≠ visual trunk after laterals). |
| **Ghost is front-plane only** | Drawn on `z ≈ 0`. Score also uses front **x–y**. Orbiting makes 3D branches look outside the card even when the front silhouette is fine — correct for bonsai “viewing angle,” confusing if players expect a 3D cage. |
| **Foliage sparsity** | Stylized scale pads never fill the cloud envelope; band-fit sweet spot is ~75% of target width so sparse trees can still grade “close.” |
| **Status contention** | Tool messages (`Cut clean…`) overwrite the practice line until the next 1.2s score tick. |
| **Original design** | Pre-change outline was a **~2.5 cm-wide S-curve** — almost unmatchable as a pad. Replaced with a proper moyogi envelope; #53 retuned to **cloud pad + classic stem rhythm** from refs (still achievable, not a solid fill win). |

## Quantitative metric

```text
score = 0.28·containment
      + 0.26·bandFit
      + 0.18·centerlineFit
      + 0.14·heightFit
      + 0.14·presenceFit
```

| Component | Meaning |
|-----------|---------|
| **containment** | Fraction of tree raster mass **inside** target polygon (`iou` field in API for stability) |
| **bandFit** | Per-height-band width & mid alignment vs target envelope |
| **centerlineFit** | Main-stem tips vs `PRACTICE_STEM` S-curve (`exp(-rmse/2cm)`) |
| **heightFit** | Tree apex vs ~25.2 cm target height (`PRACTICE_HEIGHT`) |
| **presenceFit** | Fraction of target height bands that contain any tree |

**Grades**

| Grade | Score |
|-------|-------|
| far | &lt; 0.45 |
| forming | 0.45 – 0.72 |
| close | 0.72 – 0.82 |
| match | ≥ 0.82 |

Ink opacity nudges slightly with grade (`SumiChallenge.applyScoreFeedback`).

### Visual ↔ quantitative check

| Step (auto train) | Score | What the screenshots show |
|-------------------|-------|---------------------------|
| T0 sapling | forming ~55 | Tree in lower half of cloud pad; laterals poke sides |
| T1 wild Years | forming ~66 | Taller; branches **outside** pad → higher overflow |
| T2 prune overflow | forming ~68 **best** (pre-#53 baseline) | Cleaner inside envelope; still sparse canopy |
| T3 wire S-bend | forming ~66 | Coils visible; trunk lean; centerline RMSE up |
| T5 aggressive prune | forming ~66 | High containment (~0.92); thin — band fill drops |

Soft expectations after the #53 cloud-envelope retune: automated trains should still improve over sapling; peak **forming ~0.65–0.72** remains normal. **Close** stays a soft gate (not a hard CI fail). Re-run `practice:shokunin` if hard gates regress.

**Conclusion:** When the tree looks tighter to the ink, containment/score rise; when laterals stick out or the tree is short, score falls. Metric is usable for agents and players.

## Can tools create a matching tree?

| Outcome | Result |
|---------|--------|
| Improve over sapling | **Yes** (~+0.10 automated; higher with careful human play) |
| Reach **close** | **Sometimes** (earlier seed/run hit 0.75 before grade tweak; automated run stopped at 0.68) |
| Reach **match** | **Not with a short scripted pass** — needs multi-year pad building, better viewing-front wiring, and less “prune everything long” |

So practice mode is a **meaningful training guide**, not a trivial checkbox and not currently a guaranteed “sumi complete” trophy.

## How to re-run

```bash
npm run dev
npm run practice:match      # brute-force hack path → playtest-reports/practice/
npm run practice:shokunin   # craftsman path → playtest-reports/practice/shokunin-*
```

Harness (practice is **on by default**; scripts may still set explicitly):

```js
window.__bonsai.setSumiChallenge(true)   // force practice; persists mode
window.__bonsai.setSumiChallenge(false)  // free train / sandbox
window.__bonsai.getPracticeScore()
// { score, iou, coverage, overflow, centerlineRmse, heightRatio, bandFit, grade, label }
```

## Shokunin (craftsman) path

**Issue:** #40  

The ink ghost is a classic **informal upright (moyogi)**. A craftsman works **front-first**, **structure before foliage**, **time between cuts** — never Years-spin hoping the envelope fills, and never “prune the longest 45% of tips” with uncorrelated wire dirs.

Maxim encoded in the test:

> *Cut first what is wrong, wire the line you keep, grow into the shape, never grow into a mess you refuse to edit.*

### Phase sequence

| ID | Phase | Shokunin intent | Harness actions |
|----|-------|-----------------|-----------------|
| **SK0** | Front + practice on | Choose the viewing front; commit to sumi plane | `newSapling`, `setSumiChallenge(true)`, `setView('front')`, score **T0**, screenshots |
| **SK1** | Structural prune | Remove what does not belong **before** bulk growth | Rank living tips by **envelope overflow** (tip X outside band, tip Y above apex, depth that ruins front); `act('prune')` up to N worst — **no** bulk Years yet |
| **SK2** | Trunk wire | Set the moyogi story on the primary chain | Walk parent chain from apex; `act('wire')` + `bend` toward `PRACTICE_STEM` tangents base → apex |
| **SK3** | Wire set | Let plant-time lignify the bend | `setSpeed('month')` ~3.5s wall; pause; record `wireSetAmount` |
| **SK4** | Pad flush | Grow mass **into** the envelope | 2–3 loops: short week/year burst → pinch apex overshoot → light overflow prune |
| **SK5** | Rest + read | Still the tree; unwire set wood; final grade | Optional unwire when set high; front + product screenshots; report |

### Why this is not `practice:match`

| `practice:match` (hack) | Shokunin |
|-------------------------|----------|
| Long Years first | Structure before bulk growth |
| Prune longest leaves generically | Prune by **envelope + front logic** |
| Wire mid nodes with alternating dirs | Wire **primary trunk** to `PRACTICE_STEM` |
| Aggressive multi-round tip clear | Seasonal grow → pinch → light prune loops |
| Peak ~forming 0.68 | Target **close**, aspirational **match** |

### Scoring gates

| Gate | Severity | Criterion |
|------|----------|-----------|
| Path improves | **Hard** | Best phase score ≥ T0 + 0.05 |
| No crash / pageerror | **Hard** | Zero page errors during run |
| Close | Soft | Final grade `close` or `match` (≥ 0.72) — track until consistently green |
| Match | Stretch | Final `score ≥ 0.82` |

Exit code **1** only on hard-gate failure. Soft gates are recorded in the report.

### Pure-sim helpers

Under `src/sim/practice/shokunin.ts` (unit-tested, no WebGL):

| Helper | Role |
|--------|------|
| `rankOverflowPruneTargets(tree)` | Envelope-ranked prune candidates (not length-ranked) |
| `primaryStemNodeIds(tree)` | First-child trunk chain base → apex |
| `stemBendDirections` / `stemDirectionAtHeight` | `PRACTICE_STEM` tangents for wire bends |

### How to run

```bash
# Terminal A
npm run dev

# Terminal B
npm run practice:shokunin
# → playtest-reports/practice/shokunin-report.md
# → playtest-reports/practice/shokunin-SK*.png
```

## Recommendations (follow-ups)

1. ~~**View-locked “front for practice”**~~ — **done (#66):** Practice enable soft-snaps front; optional **Lock front** in ⋯; off-axis quiet note when unlocked.  
2. **Persist practice score in the meta panel** (not only status) so tool messages don’t bury it.  
3. **Celebrate match** — call `acknowledge()` + soft ink pulse when grade first hits `match`.  
4. **Multiple targets** — cascade, literati, windswept packs once one shape is fun.  
5. **Seeded sapling for practice scripts** — reduce score variance across CI runs.  
6. **Player-facing checklist** — boot hint now covers prune / wire / grow (issue #52); optional richer checklist still open.

## Related code

- `docs/refs/sumi/` — license-safe reference pack + rationale (#53)  
- `src/sim/practice/target.ts` — shape data  
- `src/sim/practice/score.ts` — metric + tests  
- `src/sim/practice/shokunin.ts` — craftsman ranking / stem helpers + tests  
- `src/render/sumi.ts` — ghost  
- `src/app/game.ts` — `setPracticeMode`, boot default + `bonsai-en:mode`  
- `scripts/practice-match.mjs` — automated hack train + report  
- `scripts/practice-shokunin.mjs` — craftsman path + report  

