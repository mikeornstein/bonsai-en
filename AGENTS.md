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
| Git model | **Feature branches + PRs only** — never push commits directly to `main` |

## Branching and pull requests (required)

**Hard rules for agents:**

1. **Never** commit on `main` for feature work.  
2. **Never** `git push origin main` (or push a branch named `main` with new work).  
3. All changes land on `main` only via **pull request** (merge or squash after checks).  
4. Start from an up-to-date `main`, cut a feature branch, push that branch, open a PR.

### Standard flow

```bash
git fetch origin
git checkout main
git pull origin main

# Branch naming: type/short-kebab-description
git checkout -b feat/improve-juniper-foliage
# types: feat/ fix/ docs/ chore/ refactor/ test/

# … implement, test, screenshot if visual …

git add …
git commit -m "…"
git push -u origin HEAD

# Open PR into main (do not push to main)
gh pr create --base main --title "…" --body "…"
```

After review / green CI:

```bash
# Prefer merge via GitHub (UI or gh) — not by pushing main locally
gh pr merge --squash   # or --merge, per team preference
git checkout main
git pull origin main
git branch -d feat/improve-juniper-foliage   # optional cleanup
```

### When the user says “commit and push”

Interpret as:

1. Commit on the **current feature branch** (create one if still on `main`).  
2. Push **that branch** to `origin`.  
3. Open or update a **PR to `main`** if one does not exist.  
4. **Do not** push to `main`.

If already on `main` with dirty work:

```bash
git fetch origin
git checkout -b feat/describe-change
git add … && git commit -m "…"
git push -u origin HEAD
gh pr create --base main --fill   # or explicit title/body
```

### PR checklist (agent)

- [ ] Branch is not `main`  
- [ ] `npm test` and `npm run build` pass locally  
- [ ] Visual changes: `npm run screenshots` reviewed  
- [ ] PR targets `main` with a clear summary  
- [ ] No secrets, `node_modules/`, `dist/`, or `screenshots/*.png` committed  

CI on PRs: **CI** workflow (test + build). Deploy runs only after merge to `main`.

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

## Git hygiene

- **Do not commit** `screenshots/*.png`, `node_modules/`, or `dist/`.  
- Prefer GitHub **noreply** author email for this repo (push is blocked if private email is published):

  ```text
  10444033+mikeornstein@users.noreply.github.com
  ```

  Local repo config should already use this. If push fails with `GH007` private email:

  1. Confirm `git log -1 --format='%ae %ce'`.  
  2. Rewrite **unpushed feature-branch** commits with both author and committer noreply (see `docs/DEBUGGING_AND_DEPLOY.md`).  
  3. Push the feature branch again — still not `main`.  

- Push feature branches when the user asks to push; open/update PRs rather than merging locally to `main` unless the user explicitly requests a local merge workflow.

## Deploy (GitHub Pages)

Workflow: **Deploy to GitHub Pages** on every push to `main` (typically a **merged PR**) + `workflow_dispatch`.

Feature branches do **not** deploy the live site. Only `main` does.

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
| build: test or `tsc` / vite error | Code regression | Fix on a **feature branch**, PR, merge |
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
2. **PR checks** — `gh pr checks` / `gh pr view`  
3. **Pages API** — `gh api repos/mikeornstein/bonsai-en/pages`  
4. **Local** — `npm test`, `npx tsc --noEmit`, `npm run build`  
5. **Visual** — `npm run screenshots` + read images  
6. **Browser** — only if needed; headless WebGL works with Puppeteer + SwiftShader flags in the screenshot script  

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

See [docs/DEBUGGING_AND_DEPLOY.md](docs/DEBUGGING_AND_DEPLOY.md) for expanded branch/PR, CI, Pages, and troubleshooting notes.
