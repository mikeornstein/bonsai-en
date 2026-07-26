# Debugging and deploy workflow

Operational guide for humans and agents working on **bonsai-en**. Companion to [AGENTS.md](../AGENTS.md).

---

## 1. Local development

### Setup

```bash
npm install
npm run dev       # Vite → http://localhost:5173 (LAN URL printed for mobile)
npm test          # Vitest (pure sim)
npm run build     # tsc && vite build → dist/
npm run preview   # serve production build locally
```

### Environment notes

| Concern | Detail |
|---------|--------|
| Node | Local and CI use modern Node (CI: 22). |
| Path aliases | None required; relative imports under `src/`. |
| Tests | Node environment; do not import `src/render/textures.ts` from tests (uses `document`). |
| Screenshots | Require `puppeteer` (devDependency) and a running `npm run dev`. |

### Screenshot verification (required for visual work)

Visual/renderer/species presentation changes must be checked with images, not only unit tests.

```bash
# Keep dev server running
npm run dev

# Separate process
npm run screenshots
```

- Script: [`scripts/screenshot.mjs`](../scripts/screenshot.mjs)  
- Output: `screenshots/*.png` (gitignored via `screenshots/*.png`)  
- Captures:
  - `01-desktop` / `02-mobile` / `03-after-growth` / `04-orbit` — product baselines (UI on)
  - `05-ortho-front` / `06-ortho-right` / `07-ortho-top` — orthographic geometry audits (UI hidden)
  - `08-ortho-top-close` / `09-ortho-front-low` — close-up pot/soil leak checks
- Harness API (set by `src/main.ts`): `window.__bonsai.setView('front'|'right'|'top'|…)`, `setUiVisible(false)`, `setPhysicsFrozen(true)`, `getPhysicsTelemetry()`
- Clears localStorage and forces **New** sapling for consistent baselines  
- Headless Chrome flags include SwiftShader/WebGL so Three.js can render without a GPU desktop  
- Ortho audit views freeze tree physics so goldens stay stable  

**Physics stability (optional):**

```bash
npm run dev
node scripts/physics-stability.mjs   # sequential frames + maxOmega telemetry
```

At rest, `window.__bonsai.getPhysicsTelemetry().maxOmega` should go to ~0.

**Agent workflow:** write PNGs → open/read images with vision (especially ortho top for soil seal) → fix issues → re-run screenshots.

### Useful local debugging

```bash
npx tsc --noEmit          # types only
npm test -- --reporter=verbose
GITHUB_PAGES=true npm run build   # same base path as CI
npm run preview                   # check /bonsai-en/ assets if previewing with that base
```

Production base path:

- Local default: `base: '/'`  
- Pages: `GITHUB_PAGES=true` → `base: '/bonsai-en/'` in [`vite.config.ts`](../vite.config.ts)

If the live site loads HTML but JS/CSS 404, the base path is almost always wrong for the published URL.

---

## 2. Tickets, feature branches, and pull requests

**Policy:** work is **ticket-driven**. All development happens on **feature branches** that **reference a GitHub issue**. Changes reach `main` only through pull requests. **Do not push commits directly to `main`.** Issues **close when related PR(s) fully resolve them** (use `Closes #N` on the completing PR only).

Canonical short rules: [AGENTS.md](../AGENTS.md) (tickets → branches → PRs).

### Why

- Keeps `main` deployable and reviewable  
- Every change is traceable to a ticket  
- PR CI runs tests/build before merge  
- Deploy (GitHub Pages) fires only when `main` advances (merged PR)  
- Issues stay open until acceptance criteria are actually met  

### Branch naming

Always include the **issue number**:

```text
type/<issue-number>-short-kebab-description

feat/…       new capability
fix/…        bugfix
docs/…       documentation only
chore/…      tooling, deps, CI
refactor/…   structure without behavior change
test/…       tests only
```

Examples: `feat/10-hud-quiet-pass`, `fix/42-wire-springback`, `docs/9-agents-ticket-workflow`.

### Issue linking

| PR fully done for the ticket | `Closes #N` / `Fixes #N` in PR body → issue closes on merge |
| PR is partial | `Refs #N` / `Part of #N` → issue stays open |
| Several PRs | Only the **last** completing PR uses `Closes #N` |

### Day-to-day flow

```bash
gh issue view <N>    # or gh issue create …

git fetch origin
git checkout main
git pull origin main

git checkout -b feat/<N>-my-change

# implement → npm test → npm run build
# if visual: npm run screenshots and inspect PNGs

git add -A   # respect .gitignore
git commit -m "Describe the change in prose. (#N)"
git push -u origin HEAD

gh pr create --base main --title "Short title (#N)" --body "$(cat <<'EOF'
## Summary
- …

## Issue
Closes #N
# or: Refs #N  if more PRs will follow

## Test plan
- [ ] npm test
- [ ] npm run build
- [ ] screenshots (if visual)
- [ ] issue acceptance criteria met (if Closes)
EOF
)"
```

### Interpreting “commit and push”

Agents and humans should:

1. Ensure work is on a **feature branch tied to an issue** (create issue + branch if currently on `main`).  
2. Commit there (not on `main`).  
3. `git push -u origin HEAD` (the feature branch only).  
4. Create or update a **PR into `main`** that references the issue (`Closes` or `Refs`).  
5. **Never** `git push origin main` with new feature commits.
### Merging

Prefer GitHub merge (UI or CLI), not a local merge-push to `main`:

```bash
gh pr checks          # wait for CI
gh pr merge --squash  # or --merge
git checkout main && git pull origin main
```

Optional: enable branch protection on `main` (require PR, require status checks) under **Settings → Branches**. Agents cannot always change org settings; document the intent here even if protection is configured manually.

### PR CI vs deploy

| Event | Workflow | What it does |
|-------|----------|----------------|
| Pull request → `main` | **CI** (`.github/workflows/ci.yml`) | `npm ci` · test · build (no deploy) |
| Push / merge to `main` | **Deploy to GitHub Pages** | test · build · deploy live site |

---

## 3. GitHub Actions deploy

### Workflow file

[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)

| Trigger | `push` to `main` (from merged PRs), `workflow_dispatch` |
| Permissions | `contents: read`, `pages: write`, `id-token: write` |
| Concurrency | `pages` group, cancel in-progress |

### Pipeline

```
PR merged → push main
  → build job
       npm ci
       npm test
       GITHUB_PAGES=true npm run build
       upload-pages-artifact (path: dist)
  → deploy job (needs: build)
       actions/deploy-pages@v4
       environment: github-pages
```

### Live site

After a green deploy:

- GitHub Pages project URL pattern: `https://<user>.github.io/bonsai-en/`  
- This repo may also publish under the account custom domain, e.g. `…/bonsai-en/` on `mikeornstein.com`  
- Confirm current URL:

  ```bash
  gh api repos/mikeornstein/bonsai-en/pages --jq '{html_url, status, build_type, public}'
  ```

### Manual run

```bash
gh workflow run deploy.yml
gh run list --workflow=deploy.yml --limit 3
```

---

## 4. Inspecting failures (do this before asking for pasted logs)

### List and open runs

```bash
gh run list --limit 10
gh run list --workflow=ci.yml --limit 5
gh run list --workflow="Deploy to GitHub Pages" --limit 5

gh pr checks
gh pr view

gh run view <run-id>
gh run view <run-id> --log-failed    # failed steps only
gh run view <run-id> --log           # full log
gh run watch <run-id> --exit-status
```

In the GitHub UI: **Actions** → select run → failed job → expand step.  
For PR-specific failures: open the PR → **Checks**.

### Re-run

```bash
gh run rerun <run-id> --failed       # only failed jobs
gh run rerun <run-id>                # entire workflow
```

---

## 5. Common deploy / CI failures

### A. Deploy 404 — Pages not enabled

**Symptoms (deploy job):**

```text
Creating Pages deployment failed
HttpError: Not Found
Error: Failed to create deployment (status: 404)
Ensure GitHub Pages has been enabled: https://github.com/<owner>/<repo>/settings/pages
```

**Meaning:** Build/artifact succeeded; API cannot create a Pages deployment because the Pages product is not configured for the repo.

**Fix:**

```bash
# Confirm (404 body = not configured)
gh api repos/mikeornstein/bonsai-en/pages

# Enable GitHub Actions as the Pages source
gh api -X POST repos/mikeornstein/bonsai-en/pages -f build_type=workflow

# Re-run the failed workflow
gh run rerun <run-id> --failed
gh run watch <run-id> --exit-status
```

UI: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

**Historical incident (2026-07-26):** First push after adding the workflow failed at `deploy-pages@v4` with exactly this 404. Enabling Pages via API and re-running the failed jobs produced a green deploy without a new commit.

### B. Build fails — tests or TypeScript

**Symptoms:** `build` job red; deploy never starts.

**Fix locally:**

```bash
npm ci
npm test
npx tsc --noEmit
GITHUB_PAGES=true npm run build
```

Commit fix on the **feature branch**, push the branch, and let PR CI re-run (or re-run the failed check). Merge to `main` only via PR.

### C. Build fails — missing lockfile / npm ci

Prefer `package-lock.json` committed. CI uses `npm ci`. If lock is out of date: `npm install` and commit the lockfile on the feature branch.

### D. Site deploys but looks broken

| Observation | Check |
|-------------|--------|
| Blank page | Browser console; asset 404s → `base` path |
| Old app version | Hard refresh; confirm latest green Actions run SHA |
| Works locally, fails on Pages | Compare `GITHUB_PAGES=true npm run build` vs default build |
| WebGL black canvas | GPU/browser; test another device; check console for context loss |

### E. Permissions / environment

Deploy job uses environment `github-pages`. If the environment requires reviewers, deploys wait for approval in the repo **Settings → Environments**.

Workflow already requests:

```yaml
permissions:
  contents: read
  pages: write
  id-token: write
```

Do not remove `id-token: write` (OIDC for Pages).

---

## 6. Git push issues

### Accidental work on `main`

If commits were made on `main` locally before noticing:

```bash
# Move commits onto a feature branch without losing work
git branch feat/recovered-work    # points at current HEAD
git fetch origin
git reset --hard origin/main     # local main matches remote
git checkout feat/recovered-work
git push -u origin HEAD
gh pr create --base main
```

Do **not** force-push `main` to “fix” this unless the user explicitly requests it and understands the risk.

### GH007 — private email address

**Symptom:**

```text
remote: error: GH007: Your push would publish a private email address.
```

**Cause:** Commit **author** or **committer** email is a private address GitHub blocks from being published.

**Fix for unpushed feature-branch commits** (example noreply for this owner):

```bash
export GIT_AUTHOR_NAME="Mike Ornstein"
export GIT_AUTHOR_EMAIL="10444033+mikeornstein@users.noreply.github.com"
export GIT_COMMITTER_NAME="Mike Ornstein"
export GIT_COMMITTER_EMAIL="10444033+mikeornstein@users.noreply.github.com"

# On the feature branch only — rewrite last N commits
git rebase HEAD~N --exec 'git commit --amend --reset-author --no-edit'

git log -N --format='author=%ae committer=%ce subject=%s'
git push -u origin HEAD
```

**Repo-local config** (recommended once):

```bash
git config user.email "10444033+mikeornstein@users.noreply.github.com"
```

Never force-push `main` unless the user explicitly allows it and history rewrite is intended. Feature branches may be force-pushed only if they are not shared / user agrees (`--force-with-lease`).

---

## 7. Architecture debugging map

```
src/sim/          # Pure plant model — unit test here
  growth.ts       # Daily tick, carbon, seasons
  tree.ts         # Graph, sapling, world frames
  tools/          # Prune, wire
  species/        # Juniper params, future species packs

src/render/       # Three.js only
  treeMesh.ts     # Skeleton → bark tubes + instanced scales
  textures.ts     # Procedural canvas maps (browser-only)
  scene.ts        # Camera, lights, frameTree()
  materials.ts
  pot.ts

src/app/game.ts   # Tools, time speeds, dirty/throttle mesh rebuild
src/share/        # localStorage + URL hash share
```

| Bug class | Start here |
|-----------|------------|
| Growth too fast/slow, reserves, buds | `sim/growth.ts`, `sim/species/juniper.ts`, tests |
| Prune/wire wrong | `sim/tools/*`, tests |
| Ugly/wrong tree look | Screenshots → `render/treeMesh.ts`, `textures.ts` |
| Lag during Year/Month speed | `app/game.ts` visual throttle + `tickDays` max steps |
| Save/share broken | `share/encode.ts`, `sim/serialize.ts` |

---

## 8. Agent quick checklist

When the user reports a problem:

1. **Branch:** work on a feature branch; open/update a PR — never push fixes straight to `main`.  
2. **Classify:** CI/deploy vs local runtime vs visual vs sim logic.  
3. **Pull evidence yourself:** `gh run …` / `gh pr checks`, local `npm test` / build, screenshots.  
4. **Fix + verify** with the same evidence path.  
5. **Commit** when asked; use noreply email; **push the feature branch** when asked; ensure a PR exists.  
6. If deploy was red only because Pages was off, enable Pages and **re-run** — no code change required.

---

## 9. Related files

| Path | Role |
|------|------|
| [AGENTS.md](../AGENTS.md) | Short agent playbook (includes PR rules) |
| [README.md](../README.md) | Player-facing overview |
| [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) | PR / branch CI (test + build) |
| [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) | Deploy to Pages on `main` |
| [`vite.config.ts`](../vite.config.ts) | Base path for Pages |
| [`scripts/screenshot.mjs`](../scripts/screenshot.mjs) | Visual regression capture |
