# Agent notes (Grok / automated dev)

This file is the short playbook for future Grok (and other agents) working on **bonsai-en**. Prefer these commands over asking the user to paste CI logs.

## Project at a glance

| Item | Value |
|------|--------|
| Stack | Vite · TypeScript · Three.js · Vitest |
| Architecture | Pure `src/sim/` plant model; `src/render/` is a projection |
| Hosting | GitHub Pages via Actions (`.github/workflows/deploy.yml`) |
| Repo | `mikeornstein/bonsai-en` |
| Live base path | `/bonsai-en/` (Vite `base` when `GITHUB_PAGES=true`) |
| Live URLs | `https://mikeornstein.github.io/bonsai-en/` and custom domain under `mikeornstein.com/bonsai-en/` |

## Default development loop

```bash
npm install
npm run dev          # http://localhost:5173
npm test
npm run build        # tsc && vite build
```

**Visual changes:** always verify with screenshots (do not ship renderer changes un-checked).

```bash
# Terminal A
npm run dev

# Terminal B (requires puppeteer devDependency)
npm run screenshots  # → screenshots/*.png (gitignored)
```

Then **read the PNGs** with the image-capable file reader and iterate. Script: `scripts/screenshot.mjs`.

## Git and push

- Work on `main` unless the user says otherwise.
- **Do not commit** `screenshots/*.png`, `node_modules/`, or `dist/`.
- Prefer GitHub **noreply** author email for this repo (push is blocked if private email is published):

  ```text
  10444033+mikeornstein@users.noreply.github.com
  ```

  Local repo config should already use this. If push fails with `GH007` private email:

  1. Confirm `git log -1 --format='%ae %ce'`.
  2. Rewrite unpushed commits with both **author and committer** noreply (see `docs/DEBUGGING_AND_DEPLOY.md`).
  3. Push again.

- Push only when the user asks: `git push -u origin HEAD`.

## Deploy (GitHub Pages)

Workflow: **Deploy to GitHub Pages** on every push to `main` (+ `workflow_dispatch`).

### Jobs

1. **build** — `npm ci` · `npm test` · `GITHUB_PAGES=true npm run build` · upload `dist` as pages artifact  
2. **deploy** — `actions/deploy-pages@v4` (needs Pages enabled + `pages: write` / OIDC)

### Agent checklist when user says “deploy failed”

**Do not ask the user to paste errors first.** Pull them yourself:

```bash
gh run list --limit 5
gh run view <run-id> --log-failed
# or full log:
gh run view <run-id> --log
```

| Symptom | Likely cause | Fix |
|---------|----------------|-----|
| deploy: `HttpError: Not Found` / “Failed to create deployment (status: 404)” | GitHub Pages not enabled for the repo | Enable workflow-based Pages (below), then re-run |
| build: test or `tsc` / vite error | Code regression | Fix locally (`npm test` / `npm run build`), push |
| blank page / 404 assets on live site | Wrong Vite `base` for path | Ensure `GITHUB_PAGES=true` sets `base: '/bonsai-en/'` in `vite.config.ts` |
| custom domain wrong | Pages / DNS config | Check `gh api repos/mikeornstein/bonsai-en/pages` |

### Enable Pages (if missing)

```bash
# Status (404 = not configured)
gh api repos/mikeornstein/bonsai-en/pages

# Enable Actions-based Pages
gh api -X POST repos/mikeornstein/bonsai-en/pages -f build_type=workflow
```

UI alternative: **Settings → Pages → Source: GitHub Actions**.

### Re-run a failed deploy

```bash
gh run rerun <run-id> --failed
gh run watch <run-id> --exit-status
```

Or: **Actions → Deploy to GitHub Pages → Re-run failed jobs**.

### Manual dispatch

```bash
gh workflow run deploy.yml
```

## Debugging playbook

### Prefer machine-readable sources

1. **CI** — `gh run list` / `gh run view --log-failed`  
2. **Pages API** — `gh api repos/mikeornstein/bonsai-en/pages`  
3. **Local** — `npm test`, `npx tsc --noEmit`, `npm run build`  
4. **Visual** — `npm run screenshots` + read images  
5. **Browser** — only if needed; headless WebGL works with Puppeteer + SwiftShader flags in the screenshot script  

### Simulation vs render

- Growth/prune/wire/save bugs → unit tests under `src/sim/*.test.ts`, pure functions, no Three.  
- “Looks wrong” → screenshots; fix `src/render/` or species visuals; re-screenshot.  
- Fast-forward lag → mesh rebuild is throttled in `src/app/game.ts`; sim substeps vs visual dirty flags.

### Known realism gap

Current look is **improved stylized**, not photoreal. Future work: better bark/foliage assets, denser scale pads, soil/lighting, LOD. Always screenshot after visual PRs.

## Architecture reminders

- **Do not** import Three.js from `src/sim/`.  
- Tree state is JSON-serializable (`schemaVersion: 1`).  
- Share links: LZ-string in URL hash (`src/share/encode.ts`); large trees fall back to file export.  

## Full detail

See [docs/DEBUGGING_AND_DEPLOY.md](docs/DEBUGGING_AND_DEPLOY.md) for expanded commands, incident history, and troubleshooting.
