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
| Git model | **Issues → branches → PRs** — never commit or push directly to `main` |

## Tickets, branches, and pull requests (required)

Work is **ticket-driven**. Every change ships on a **branch** that references a **GitHub issue**. Issues close only when the work is fully done (via merged PR(s)).

### Hard rules for agents

1. **Never** commit on `main` for product work.  
2. **Never** `git push origin main` (or push new work on a branch named `main`).  
3. **All work is done on branches** — implement, test, commit, and push only on the feature branch.  
4. **Every branch references an issue** — branch name and PR body include the issue number.  
5. Changes land on `main` **only** via pull request (merge or squash after checks).  
6. **Issues close when the work is complete** — not when a partial PR opens. Use GitHub closing keywords so the last resolving PR closes the issue.

### Ticket workflow

```text
Issue (ticket)  →  branch named with issue #  →  one or more PRs  →  merge  →  issue closes
```

| Step | What agents do |
|------|----------------|
| **1. Pick or create a ticket** | Use an existing open issue, or `gh issue create` if the user asked for work with no ticket. Prefer epics/children already labeled (`art-direction`, `phase-a`, …). |
| **2. Branch from up-to-date `main`** | Branch name **must** include the issue number (see naming below). |
| **3. Implement only on that branch** | Commits stay off `main`. Link commits with `(#N)` when helpful. |
| **4. Open a PR into `main`** | PR title/body **must** reference `#N`. |
| **5. Resolve the issue via PR(s)** | When the PR **fully** satisfies the issue acceptance criteria, use a closing keyword. If more PRs are still needed, use a non-closing reference. |
| **6. After merge** | Pull `main`, delete the local branch, confirm the issue state. |

### Branch naming

Always include the issue number:

```text
type/<issue-number>-short-kebab-description
```

| Type | Use |
|------|-----|
| `feat/` | New capability |
| `fix/` | Bugfix |
| `docs/` | Documentation only |
| `chore/` | Tooling, deps, CI |
| `refactor/` | Structure without behavior change |
| `test/` | Tests only |

Examples:

```text
feat/10-hud-quiet-pass
fix/42-wire-springback
docs/9-agents-ticket-workflow
```

No issue yet? Create one first, then branch — do not invent `feat/wip-no-ticket` for real product work.

### Issue ↔ PR linking (closing rules)

| Situation | In the PR body (or title) | Issue result |
|-----------|---------------------------|--------------|
| This PR **fully** resolves the issue (acceptance criteria met) | `Closes #N` or `Fixes #N` | Issue **closes** when the PR merges |
| This PR is **partial** work; more PRs will follow | `Refs #N` or `Part of #N` — **do not** use Closes/Fixes | Issue **stays open** |
| Multiple PRs required | Only the **last** PR that completes the issue uses `Closes #N`; earlier PRs use `Refs #N` | Issue closes when the final PR merges |
| PR abandoned / wrong approach | Close the PR without `Closes`; leave the issue open or comment why | Issue stays open until real resolution |

GitHub auto-closes on merge when the PR body contains `Closes #N` / `Fixes #N` / `Resolves #N` (against the default branch). Prefer putting the keyword in the **PR body**, not only the commit message.

**Do not** manually close an issue while related open PRs still claim to address it, or while acceptance criteria remain unmet. **Do** re-open (or comment) if a “closed” issue regressed.

### Standard flow

```bash
# 0) Know the ticket
gh issue view <N>
# or create: gh issue create --title "…" --body "…"

git fetch origin
git checkout main
git pull origin main

# 1) Branch always carries the issue number
git checkout -b feat/<N>-short-kebab-description

# 2) … implement, test, screenshot if visual … (all on this branch)

git add …
git commit -m "Describe change (#N)"
git push -u origin HEAD

# 3) PR into main — link the issue; close only if fully done
gh pr create --base main --title "feat: short title (#N)" --body "$(cat <<'EOF'
## Summary
- …

## Issue
Closes #<N>
# or: Refs #<N>   ← if more work remains after this PR

## Test plan
- [ ] npm test
- [ ] npm run build
- [ ] screenshots (if visual)
- [ ] issue acceptance criteria satisfied (if Closes)
EOF
)"
```

After review / green CI:

```bash
# Prefer merge via GitHub (UI or gh) — not by pushing main locally
gh pr merge --squash   # or --merge, per team preference
git checkout main
git pull origin main
git branch -d feat/<N>-short-kebab-description   # optional cleanup

# Confirm ticket state when you used Closes
gh issue view <N>   # should be CLOSED if the PR fully resolved it
```

### Multiple PRs for one issue

Split large tickets when needed (e.g. scaffolding then polish), but:

1. Every PR still targets the **same issue number** (`Refs #N` or `Closes #N`).  
2. Keep a short comment on the issue listing open/merged PRs if the chain is non-obvious.  
3. Only the PR that meets **all** acceptance criteria uses `Closes #N`.  
4. Do not open orphan branches with no issue.

### When the user says “commit and push”

Interpret as:

1. Ensure work is on a **feature branch tied to an issue** (create issue + branch if still on `main` or untracked).  
2. Commit on **that branch**.  
3. Push **that branch** to `origin`.  
4. Open or update a **PR to `main`** that references the issue.  
5. **Do not** push to `main`.

If already on `main` with dirty work:

```bash
# Prefer attaching to an existing open issue; otherwise create one
N=$(gh issue create --title "…" --body "…" | grep -oE '[0-9]+$')
git fetch origin
git checkout -b feat/${N}-describe-change
git add … && git commit -m "… (#${N})"
git push -u origin HEAD
gh pr create --base main --title "… (#${N})" --body "Closes #${N}"
```

### When the user says “work on ticket N” / “do issue N”

```bash
gh issue view N
git fetch origin && git checkout main && git pull origin main
git checkout -b feat/N-short-slug-from-title
# implement acceptance criteria from the issue body
# open PR with Closes #N (or Refs #N if splitting)
```

If a branch for `N` already exists remotely, check it out / continue that PR instead of forking a duplicate.

### PR checklist (agent)

- [ ] Branch is **not** `main`  
- [ ] Branch name includes **issue number** (`type/N-slug`)  
- [ ] PR body has `Closes #N` **or** `Refs #N` (always one of these)  
- [ ] `Closes` only if this PR fully meets the issue’s acceptance criteria  
- [ ] `npm test` and `npm run build` pass locally  
- [ ] Visual changes: `npm run screenshots` reviewed  
- [ ] PR targets `main` with a clear summary  
- [ ] No secrets, `node_modules/`, `dist/`, or `screenshots/*.png` committed  

CI on PRs: **CI** workflow (test + build). Deploy runs only after merge to `main`.

### Finding work

```bash
gh issue list --limit 20
gh issue list --label phase-a          # e.g. art-direction phases
gh issue list --label art-direction
gh issue view <N>
```

Epics (e.g. parent art-direction issues) stay open until children are done; child issues close via their own PRs. Do not put all epic work on one branch unless the epic itself is the only ticket.
## Default development loop

```bash
npm install
npm run dev          # http://localhost:5173
npm test
npm run build        # tsc && vite build
```

**Playtests (agent / regression):** with the dev server up, run the scenario playthrough:

```bash
# Terminal A
npm run dev

# Terminal B
npm run playtest     # → playtest-reports/latest.md + shots (gitignored)
```

Hard scenario failures exit non-zero. Soft findings (playability, SwiftShader perf) land in the report. Harness API: `window.__bonsai.getSnapshot()`, `act(tool, nodeId)`, `setSpeed`, `listNodes`, `getPerf`, `getPracticeScore()`.

**Practice (sumi) mode:** **on by default** (sumi ghost + live grade). Free train / sandbox is a deliberate opt-out via `⋯ → Free train` (persists in `localStorage` key `bonsai-en:mode` = `practice` | `sandbox`). Toggle via UI or `setSumiChallenge(true|false)`. Score with `getPracticeScore()` (containment, band fit, centerline, height). Deep dive: [docs/practice-mode.md](./docs/practice-mode.md). Automated trains: `npm run practice:match` (hack path) · `npm run practice:shokunin` (craftsman SK0–SK5 path → `playtest-reports/practice/shokunin-*`) — both still call `setSumiChallenge(true)` or rely on default-on.

**Visual changes:** always verify with screenshots (do not ship renderer changes un-checked).

```bash
# Terminal A
npm run dev

# Terminal B (requires puppeteer devDependency)
npm run screenshots  # → screenshots/*.png (gitignored)
```

Then **read the PNGs** with the image-capable file reader and iterate. Script: `scripts/screenshot.mjs`.

Orthographic audits (`05`–`09`) hide the HUD and use `window.__bonsai.setView(...)` for front/right/top (and close-ups). Prefer top + front-low when checking pot/soil watertightness.

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

Pot/soil are **physically closed** (thick lathe + volumetric soil). IBL uses a procedural **zen-garden HDRI** (PMREM) for ceramic/wire reflections; visible background stays a soft cyclorama so the garden does not compete with the tree. Tree foliage is still **improved stylized** (instanced scale pads), not photoreal juniper. Future work: denser foliage assets, better bark, LOD. Always re-run `npm run screenshots` (including ortho views) after visual PRs.

### Soft GL vs product GPU (lighting / DOF)

| Path | When | Post stack | What you see |
|------|------|------------|--------------|
| **Soft GL** | SwiftShader / llvmpipe / Software (agent Puppeteer screenshots, many CI boxes) | **Skipped entirely** — no Bokeh, SMAA, or grade | Full-sharp, linear renderer path; good for geometry / value of materials + lights only |
| **Product GPU** | Real browser on a device GPU | Grade + subtle DOF + SMAA after first frame | Portrait still-life: sharp trunk + primary pads, far floor gently soft |

- Ortho audit views (`setView('front'|'top'|…)`) **disable DOF** even on product GPUs (full-sharp geometry checks).
- A/B on product GPU: URL `?dof=0` or harness `window.__bonsai.setDofEnabled(false)` / `getDofEnabled()`.
- **Art review of lighting/DOF must use a real GPU capture** (or both soft-GL stills *and* a local product grab). Headless screenshots alone mislead on bokeh and grade.

### Runtime tree physics

Live elastic dynamics live in `src/sim/physics/` (pure TS, no Three.js):

- Each internode has **mass / stiffness / damping**; gravity sags the canopy.
- **Prune** removes distal mass → parent chain **springs up**.
- **Camera orbit** injects inertial forces (jiggle).
- **Collisions** prevent interpenetration (capsule–capsule, soil, pot — sibling/endpoint pairs filtered).
- Joints **sleep** when quiet so a stationary camera does not buzz.
- Physics state is **session-only** (not in `TreeState` saves). Freeze for screenshots via `window.__bonsai.setPhysicsFrozen(true)` / ortho `setView`.

**Telemetry** (quantitative settle checks):

```js
window.__bonsai.getPhysicsTelemetry()
// { maxOmega, rmsOmega, maxTheta, kineticEnergy, freeJoints, sleeping, contacts, simTime }
```

At rest (no orbit), `maxOmega` and `kineticEnergy` should go to ~0 and `sleeping === freeJoints`.  
Script: `BONSAI_URL=http://localhost:5173/ node scripts/physics-stability.mjs` → `screenshots/physics-seq-*.png` + `physics-telemetry.json`.

## Architecture reminders

- **Do not** import Three.js from `src/sim/`.  
- Tree state is JSON-serializable (`schemaVersion: 1`).  
- Share links: LZ-string in URL hash (`src/share/encode.ts`); large trees fall back to file export.  

## Full detail

See [docs/DEBUGGING_AND_DEPLOY.md](docs/DEBUGGING_AND_DEPLOY.md) for expanded branch/PR, CI, Pages, and troubleshooting notes.
