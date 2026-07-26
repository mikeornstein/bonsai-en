# Baseline playtest report (2026-07-26)

Automated run via `npm run playtest` against local Vite (headless Chromium + SwiftShader).  
**Result: 15/15 scenarios passed**, 3 automated findings + visual notes below.

Re-run:

```bash
npm run dev          # terminal A
npm run playtest     # terminal B → playtest-reports/latest.md
```

> Frame-time numbers are **SwiftShader-relative**, not product-GPU absolute.

## Scenario results

| ID | Scenario | Result | Highlights |
|----|----------|--------|------------|
| S0 | Boot | ✓ | HUD leaves placeholders; season/age populated |
| S1 | New sapling | ✓ | Intentional start age ~120 plant-days (“4 months”) |
| S2 | Time controls (UI) | ✓ | Years advances age; Still freezes; tool buttons bind |
| S3 | Grow young tree | ✓ | Nodes grow under Years; **vitality often Low** |
| S4 | Inspect | ✓ | Selection copy updates |
| S5 | Prune | ✓ | Node count drops; physics stays stable |
| S6 | Pinch | ✓ | Tip pinch accepted |
| S7 | Wire / bend / unwire | ✓ | Wire applies; bend; unwire clears flag |
| S8 | Orbit + physics | ✓ | Settles to sleep; canvas pick usually works near canopy |
| S9 | Save / restore | ✓ | localStorage round-trip preserves age/nodes |
| S10 | Share | ✓ | Hash encodes; **URL often too long → file fallback** |
| S11 | Export JSON | ✓ | Valid schema v1 |
| S12 | Stress / perf | ✓ | ~280 nodes after ~8s Years; **high frame cost under SW** |
| S13 | Mobile 390×844 | ✓ | Tools + files menu usable |
| S14 | Sumi + mute | ✓ | Harness toggles clean |

## Findings

### P1 · playability · Vitality crashes on Years fast-forward

**Observed:** After ~4s of Years speed from a fresh sapling (~1 plant year), vitality often reads **Low** (reserves ~3–6) while season may be Dormant/Late rest.

**Why it matters:** Players who “spin years” to shape an older tree see a red vitality bar and may think they killed the plant, even though later seasons can recover (stress run showed Abundant at 1.6y).

**Repro:** New sapling → Years → wait ~4s → Still. Check Vitality.

**Ideas:** Soft floor under fast-forward, season-aware reserve smoothing, or status copy (“winter rest · low sap”) so Low reads as seasonal not death.

---

### P2 · playability · Share-by-link fails by ~60 nodes

**Observed:** At ~60 nodes, LZ share hash length ≈ 17k (URL ≳ 8k limit in `copyShareLink`). Status: *“Tree too large for a link — file downloaded”*.

**Why it matters:** Share is a primary social affordance; it only works for very young trees. Most play sessions hit the fallback quickly.

**Repro:** Grow past ~1 year or any moderately branched tree → Share.

**Ideas:** Raise threshold with stronger compression, host short links, or split export vs share UX more clearly in the menu.

---

### P3 · performance · Years growth is expensive as node count rises

**Observed (SwiftShader):** At ~281 nodes during Years, median `avgFrameMs` ≈ **200ms** (spikes to 400–600ms). Physics sleep at rest is fine (maxΩ → 0).

**Why it matters:** Even if product GPUs are faster, mesh rebuild + sim substeps under Years are the hot path. Mobile devices will feel hitchy when accelerating time on bushy trees.

**Repro:** `npm run playtest` S12, or New → Years for ~10s with `?debug=1` and watch Nodes.

**Ideas:** Stronger visual throttle, coarser sim LOD at year speed, foliage instance budgets, skip physics substeps when frozen/paused.

---

## Visual / playability notes (manual review of shots)

| Note | Severity | Detail |
|------|----------|--------|
| Sparse scale pads | polish / known | Canopy reads thin vs real juniper; art-direction backlog |
| Pale sphere buds | polish | Read as “berries” more than buds; may confuse tool targeting |
| Soft ground shadow blob | polish | Diffuse shadow under pot looks like a stain at some angles |
| Status line sticky | polish | “New juniper sapling” stays after years of growth until another status fires |
| Wire set is slow | playability | After ~2.5s Month, `setAmount` only ~0.02–0.03 — lignify feedback is subtle |
| Mobile files menu | ok | Opens above tools; usable though dense |

## What worked well

- Boot recovery / playable sapling path is solid  
- Prune / pinch / wire / unwire sim paths are consistent  
- Physics settles (sleep) after orbit and prune  
- Save/restore and export are reliable  
- Quiet HUD layout is readable on desktop and mobile  

## Harness surface (for future scenarios)

```js
window.__bonsai.getSnapshot()
window.__bonsai.listNodes()
window.__bonsai.act('prune'|'pinch'|'wire'|'unwire'|'inspect', nodeId)
window.__bonsai.bend(nodeId, [x,y,z])
window.__bonsai.setSpeed('year'|'pause'|…)
window.__bonsai.getPerf()
window.__bonsai.saveNow() / exportJson() / getShareHash()
```

## Related issues

| Topic | Issue |
|-------|--------|
| Automation + this baseline | #31 |
| Vitality Low on Years FF (P1) | #32 |
| Share link size limit (P2) | #33 |
| Years performance (P3) | #34 |

See also `npm run playtest` → `playtest-reports/latest.md` (gitignored, regenerable).
