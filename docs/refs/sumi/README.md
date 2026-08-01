# Sumi / moyogi practice references

**Issues:** #53 (moyogi grounding) · #72 (cascade / literati packs)  
**Purpose:** Ground practice-mode target geometry (`src/sim/practice/target.ts`) and sumi ink ghost (`src/render/sumi.ts`) in classic informal-upright (moyogi) proportion and ink language—not invent the silhouette from code alone. Extra packs (#72) reuse the same ink language with new stem/envelope coordinates (no new plate binaries required for cascade/literati v1).

## How we use these

| Use | Rule |
|-----|------|
| **Geometry** | Front silhouette only: stem S-curve rhythm, foot/waist/pad/apex envelope. Coordinates stay soil-local meters. |
| **Ink read** | Brush weight hierarchy (stem > outline > fill), negative space, quiet presence so living wood stays primary. |
| **Scoring** | Target polygon + `PRACTICE_STEM` feed `scorePracticeMatch`; refs justify shape, not hard “photocopy” matching. |
| **Not used for** | Photoreal foliage or a full style catalog. Packs moyogi / cascade / literati live in `target.ts` (#72); optional future plates for cascade/literati can land here. |

**License policy:** Only public-domain, Creative Commons, or **original** plates generated for this repo. Attribution required for CC works. Do not add copyrighted books, stock, or social-media scrapes as binaries.

---

## In-repo plates

### A. Wikimedia / CC photographs & diagrams

| File | Source | License | Author | What we take from it |
|------|--------|---------|--------|----------------------|
| [`moyogi-training-sequence.jpg`](./moyogi-training-sequence.jpg) | [File:How to make a moyogi style bonsai.jpg](https://commons.wikimedia.org/wiki/File:How_to_make_a_moyogi_style_bonsai.jpg) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | [Tangopaso](https://commons.wikimedia.org/wiki/User:Tangopaso) | Multi-year moyogi trunk: first bend, counter-bend, structure before dense pad (steps 2–4). Primary driver for **stem polyline** rhythm. |
| [`moyogi-juniper-procumbens.jpg`](./moyogi-juniper-procumbens.jpg) | [File:Dwarf Japanese Juniper, 1975-2007.jpg](https://commons.wikimedia.org/wiki/File:Dwarf_Japanese_Juniper,_1975-2007.jpg) (500px thumb) | [CC BY-SA 2.5 / 3.0](https://creativecommons.org/licenses/by-sa/3.0/) · GFDL | [Ragesoss](https://commons.wikimedia.org/wiki/User:Ragesoss) | *Juniperus procumbens* ‘Nana’ (our species family). **Cloud pad** mass, soft apex, asymmetric left/right foliage, visible trunk movement between pads. |
| [`moyogi-redwood-informal.jpg`](./moyogi-redwood-informal.jpg) | [File:Redwood bonsai.JPG](https://commons.wikimedia.org/wiki/File:Redwood_bonsai.JPG) (resized) | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) · GFDL | Jeffrey O. Gustafson | Explicit **informal upright** front: broad upper canopy, layered pads, trunk under canopy, product pot/value hierarchy. |
| [`moyogi-california-juniper.jpg`](./moyogi-california-juniper.jpg) | [File:California-juniper-bonsai-collection.jpg](https://commons.wikimedia.org/wiki/File:California-juniper-bonsai-collection.jpg) (500px) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | Nathan Andersen | Pre-bonsai **movement** and negative space (yamadori recovery)—not a finished diamond; reminds us not to score solid filled pads. |
| [`moyogi-exhibit-front.jpg`](./moyogi-exhibit-front.jpg) | [File:Bonsai IMG 6426.jpg](https://commons.wikimedia.org/wiki/File:Bonsai_IMG_6426.jpg) (500px) | [CC BY-SA 2.5](https://creativecommons.org/licenses/by-sa/2.5/) | [Dake](https://commons.wikimedia.org/wiki/User:Dake~commonswiki) | Exhibit still: tree vs pot/soil value hierarchy; ink ghost must stay secondary to living material in product view. |

Thumbs are compressed for repo size; full-resolution originals live on Wikimedia Commons under the same licenses.

### B. Original plates (repo-owned)

Generated for bonsai-en art direction (issue #53). License: **CC0 / public domain dedication** for use inside this project (geometry study only; not third-party stock).

| File | Intent |
|------|--------|
| [`ink-silhouette-moyogi-original.jpg`](./ink-silhouette-moyogi-original.jpg) | Sumi brush language: heavy trunk, soft cloud pads, negative space between pads. Guides **line weight** and pad “not a solid diamond” read. |
| [`ink-envelope-diagram-original.jpg`](./ink-envelope-diagram-original.jpg) | Soft filled envelope + S-curve stem study. Guides **practiceTargetPolygon** lobes (foot → waist → upper pad → rounded apex). |

---

## Geometry rationale (target.ts)

Grounded in the plates above:

1. **Stem (`PRACTICE_STEM`)** — Tangopaso sequence + original envelope: clear **first left bend**, **right counter** mid-trunk, **upper return**, apex near centerline (classic moyogi “story,” not windswept). Amplitudes stay ~1–2 cm so wire + set can approach centerline score.
2. **Envelope (`practiceTargetPolygon`)** — Away from pure diamond toward **cloud silhouette** (procumbens, redwood, original ink): narrow nebari foot, soft mid **waist** (trunk read), fuller asymmetric upper pad (slightly more mass mid-right), **rounded apex** instead of a hard point.
3. **Scale** — Still ~25 cm soil-to-apex training sapling (`PRACTICE_HEIGHT ≈ 0.25 m`); half-width ~7 cm keeps band-fit achievable with stylized pads.

Scoring API and grade bands are unchanged for moyogi; only the shared geometry moves.

### Pack geometry notes (#72)

| Pack | Stem story | Envelope | Scale |
|------|------------|----------|--------|
| **moyogi** | First left · right counter · upper return (above) | Cloud pad | ~25 cm, half-width ~7 cm |
| **cascade** | Rise to crest, then flow +x and down past rim | Flowing teardrop (semi-cascade) | Crest ~11 cm; tip `yMin ≈ −5 cm` |
| **literati** | Tall sparse S (bunjin rhythm) | Narrow pad stack | ~32 cm, half-width ~3.8 cm |

No new binary plates for cascade/literati in v1 — geometry is tuned for front-view ink readability with similar vertex density to moyogi. Study links: Wikimedia [Cascade style bonsai](https://commons.wikimedia.org/wiki/Category:Cascade_style_bonsai), [Literati style bonsai](https://commons.wikimedia.org/wiki/Category:Literati_style_bonsai) (do not commit unclear-license binaries).

---

## Graphics rationale (sumi.ts)

From original ink plate + exhibit stills:

| Element | Intent |
|---------|--------|
| Fill | Very quiet wash (low opacity) — suggestion of pad mass, not a sticker |
| Outline | Soft warm ink; secondary to living wood and stem |
| Stem | Slightly stronger / darker — trunk is the moyogi story |
| Grade feedback | Small opacity nudges only; match ≠ opaque black card |

No paper grain shader (would fight soft-GL audits); hierarchy is opacity + value only.

---

## Linked study notes (no binary)

Additional study links (do **not** commit if license is unclear or commercial):

- [Wikimedia Category: Informal upright style bonsai](https://commons.wikimedia.org/wiki/Category:Informal_upright_style_bonsai)
- [Wikimedia Category: Bonsai](https://commons.wikimedia.org/wiki/Category:Bonsai)
- Classic moyogi teaching texts (Lesniewicz et al.) are **copyrighted** — use only for private study; proportions already reflected via Tangopaso’s open diagram derived from that tradition.

---

## Attribution snippet (for PR / credits)

```text
Moyogi training diagram © Tangopaso, CC BY-SA 4.0
Dwarf Japanese Juniper photo © Ragesoss, CC BY-SA 2.5/3.0
Redwood informal upright © Jeffrey O. Gustafson, CC BY-SA 3.0
California juniper collection © Nathan Andersen, CC BY-SA 4.0
Exhibit bonsai (Martigny) © Dake, CC BY-SA 2.5
Original ink plates: bonsai-en #53, CC0
```

When redistributing modified CC BY-SA images outside this repo, follow share-alike terms on the source Commons pages.
