# Practice mode deep dive

**Issue:** #36  
**Date:** 2026-07-26  

## What practice mode is

`⋯ → Practice` toggles a **sumi ink silhouette** (soft fill + outline + stem line) of a classic **informal upright (moyogi)** target. Geometry is shared between:

| Layer | File |
|-------|------|
| Target coordinates (soil-local m) | `src/sim/practice/target.ts` |
| Quantitative score | `src/sim/practice/score.ts` |
| Visual ghost | `src/render/sumi.ts` |
| Live HUD + harness | `Game.getPracticeScore()`, `window.__bonsai.getPracticeScore()` |

Off by default. Enabling sets status to a live grade label, e.g. `Practice · forming 68`.

## Does it make sense?

### Yes (after this work)

1. **Target scale** matches a ~1–2 year training sapling (~25 cm tall, pot-width pad).
2. **Visual guide** is readable in front ortho and product view (faint diamond + S-curve stem).
3. **Score** tracks what you see: wild laterals raise overflow; prune pulls material inside; short trees score lower on height/band fill.
4. **Tools matter:** prune/wire/grow can move the score (~+0.10 in the automated playthrough). Containment improves when strays are cut.

### Gaps / caveats

| Issue | Detail |
|-------|--------|
| **Not a filled “win” condition yet** | Automated train peaked **forming ~0.68**, best runs earlier hit **close ~0.75**. **Match (≥0.82)** needs denser pad mass + trunk line, not only pruning sticks. |
| **Wire is a double-edged tool** | Bending improved band fit / containment in some steps but **worsened centerline RMSE** (first-child stem path ≠ visual trunk after laterals). |
| **Ghost is front-plane only** | Drawn on `z ≈ 0`. Score also uses front **x–y**. Orbiting makes 3D branches look outside the card even when the front silhouette is fine — correct for bonsai “viewing angle,” confusing if players expect a 3D cage. |
| **Foliage sparsity** | Stylized scale pads never fill the diamond; band-fit sweet spot is ~75% of target width so sparse trees can still grade “close.” |
| **Status contention** | Tool messages (`Cut clean…`) overwrite the practice line until the next 1.2s score tick. |
| **Original design** | Pre-change outline was a **~2.5 cm-wide S-curve** — almost unmatchable as a pad. Replaced with a proper moyogi envelope. |

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
| **heightFit** | Tree apex vs 25.5 cm target height |
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
| T0 sapling | forming ~55 | Tree in lower half of diamond; laterals poke sides |
| T1 wild Years | forming ~66 | Taller; branches **outside** pad → higher overflow |
| T2 prune overflow | forming ~68 **best** | Cleaner inside envelope; still sparse canopy |
| T3 wire S-bend | forming ~66 | Coils visible; trunk lean; centerline RMSE up |
| T5 aggressive prune | forming ~66 | High containment (~0.92); thin — band fill drops |

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
npm run practice:match   # → playtest-reports/practice/
```

Harness:

```js
window.__bonsai.setSumiChallenge(true)
window.__bonsai.getPracticeScore()
// { score, iou, coverage, overflow, centerlineRmse, heightRatio, bandFit, grade, label }
```

## Recommendations (follow-ups)

1. **View-locked “front for practice”** — optional snap camera to front when Practice turns on so ink and score agree with what the player sees.  
2. **Persist practice score in the meta panel** (not only status) so tool messages don’t bury it.  
3. **Celebrate match** — call `acknowledge()` + soft ink pulse when grade first hits `match`.  
4. **Multiple targets** — cascade, literati, windswept packs once one shape is fun.  
5. **Seeded sapling for `practice:match`** — reduce score variance across CI runs.

## Related code

- `src/sim/practice/target.ts` — shape data  
- `src/sim/practice/score.ts` — metric + tests  
- `src/render/sumi.ts` — ghost  
- `scripts/practice-match.mjs` — automated train + report  
