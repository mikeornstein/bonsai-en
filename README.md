# Bonsai-en

A biologically grounded **3D bonsai training simulation** in the browser. Tend a juniper sapling with real bonsai techniques—prune, pinch, wire, and wait—while plant-time runs from live nursery pace to years per second.

**Stack:** Vite · TypeScript · Three.js · static hosting on GitHub Pages (mobile + desktop).

## Play

```bash
npm install
npm run dev
```

Open the local URL (default `http://localhost:5173`). On a phone, use your LAN address shown by Vite.

### Controls

| Action | How |
|--------|-----|
| Orbit | Drag |
| Zoom | Scroll / pinch |
| Inspect | Tool → tap branch |
| Prune | Remove branch + everything beyond |
| Pinch | Soft tip prune; encourages back-budding |
| Wire | Tap to apply, drag to bend; leave on while wood lignifies |
| Unwire | Remove wire (unset wood springs back) |
| Time | Pause · Live · Day · Week · Month · Year per real second |
| Save | Browser autosave + manual Save |
| Share | Copies a compressed URL hash (or exports JSON if too large) |

Keyboard: `I` inspect · `P` prune · `N` pinch · `W` wire · `U` unwire · `Space` pause/live.

## Botanical model (core)

Trees are a **functional-structural plant model** (mutable internode graph), not a one-shot L-system mesh:

- **Primary growth** from terminal and axillary buds  
- **Secondary thickening** via a pipe-model (distal foliage area supports basal cross-section)  
- **Apical dominance** with decay along the axis; pruning raises bud-break force (back-budding)  
- **Carbon pool**: photosynthesis − maintenance → primary / secondary / roots / storage  
- **Seasons** modulate flush intensity (juniper is evergreen but still flushes)  
- **Wiring**: orientation constrained; **lignification** permanently sets bend over plant-time  

Species packs (`src/sim/species/`) parameterize morphology and rates. Phase 1 ships **Juniperus procumbens**-inspired defaults.

Simulation code lives in `src/sim/` (no Three.js). Rendering in `src/render/` projects the same state each dirty frame.

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Local dev server |
| `npm run build` | Typecheck + production build to `dist/` |
| `npm run preview` | Preview production build |
| `npm test` | Vitest unit tests for growth / prune / wire |
| `npm run screenshots` | Headless captures → `screenshots/*.png` (dev server must be up) |

## Contributing workflow

Work on **feature branches** and open **pull requests** into `main`. Do not push commits directly to `main`.

```bash
git checkout main && git pull
git checkout -b feat/my-change
# … commit …
git push -u origin HEAD
gh pr create --base main
```

- **PR CI** (`.github/workflows/ci.yml`): test + build on pull requests  
- **Deploy** (`.github/workflows/deploy.yml`): after merge to `main` only  

Details: [AGENTS.md](./AGENTS.md) and [docs/DEBUGGING_AND_DEPLOY.md](./docs/DEBUGGING_AND_DEPLOY.md).

## GitHub Pages

Merges to `main` run `.github/workflows/deploy.yml`:

1. `npm ci` · `npm test` · `npm run build` with `GITHUB_PAGES=true` (base `/bonsai-en/`)  
2. Deploys the `dist` artifact to GitHub Pages  

Source must be **Settings → Pages → GitHub Actions** (or enable via API — see deploy docs below).

For a custom repo name, change `base` in `vite.config.ts` to match `https://<user>.github.io/<repo>/`.

### Debugging & deploy (for developers and Grok)

| Doc | Audience |
|-----|----------|
| [AGENTS.md](./AGENTS.md) | Short playbook for automated agents (branches, PRs, deploy) |
| [docs/DEBUGGING_AND_DEPLOY.md](./docs/DEBUGGING_AND_DEPLOY.md) | Full CI, PR flow, Pages, screenshots, troubleshooting |

Agents should pull CI failures with `gh run view <id> --log-failed` / `gh pr checks` instead of asking for pasted logs.

## Save format

JSON schema version `1` (`TreeState` in `src/sim/types.ts`): full node graph, buds, foliage, wires, reserves, seed, plant age. Share links compress this into the URL hash (`#s=...`) with LZ-string.

## Roadmap (beyond core)

- Shape challenges (target silhouettes)  
- Multi-tree nursery layout  
- More species packs  
- Root work / repotting, jin & shari  
- Richer PBR bark/foliage and mobile LOD  

## License

Private / TBD.
