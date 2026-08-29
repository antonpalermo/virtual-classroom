# CI Version Bump Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the repo's first CI workflow — a GitHub Actions job on `changesets/action@v1` that opens/updates a "Version Packages" PR against `dev` whenever pending changesets exist — and update `CLAUDE.md` so the docs describe the new bot-driven flow instead of the old "run it manually" framing.

**Architecture:** A single workflow file (`.github/workflows/version.yml`) triggers on every push to `dev`, runs `npm ci`, then hands off to `changesets/action@v1` configured with `version: npm run version-packages` and no `publish` input (every workspace is `private: true` and never published to npm, so publish is intentionally omitted). Doc updates land in the same branch: `CLAUDE.md`'s `## Versioning` section gets the new workflow description, and its `## Branching` section's stale "No CI ... exists yet" line is corrected now that a CI workflow exists (branch protection still doesn't).

**Tech Stack:** GitHub Actions, `changesets/action@v1` (community action, not an npm dependency — referenced by tag in the workflow YAML, nothing to `npm install`), the `version-packages` script and `.changeset/config.json` already on `dev` from PR #21.

**Spec:** [docs/superpowers/specs/2026-08-28-ci-version-bump-design.md](../specs/2026-08-28-ci-version-bump-design.md)

## Global Constraints

- The workflow triggers on `push: branches: [dev]` — matches `baseBranch: "dev"` in `.changeset/config.json`. It must never trigger on `main`; CI never pushes to `main` directly (existing branching rule).
- No `publish` input, no `NPM_TOKEN` — every workspace is `private: true` and unpublished. Only `version: npm run version-packages` is configured.
- `permissions: contents: write, pull-requests: write` on the job — the minimum `changesets/action` needs to open/update its PR with the default `GITHUB_TOKEN`.
- The `version-packages` script (`changeset version`) and `.changeset/config.json` must already exist on the branch this plan is executed against (both landed via PR #21, already merged into `dev` as of this plan).
- No lint/test CI gate, no branch protection, no tagging/publishing — all explicitly out of scope per the spec's Non-goals.

---

### Task 1: Add the version-bump workflow

**Files:**
- Create: `.github/workflows/version.yml`

**Interfaces:**
- Consumes: `npm run version-packages` (root `package.json` script, already present).
- Produces: nothing other apps/tasks depend on — this is a standalone CI trigger.

- [ ] **Step 1: Create the workflow file**

Create `.github/workflows/version.yml` with exactly this content:

```yaml
name: Version Packages

on:
  push:
    branches: [dev]

concurrency:
  group: version-packages-${{ github.ref }}
  cancel-in-progress: false

permissions:
  contents: write
  pull-requests: write

jobs:
  version:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: package.json
          cache: npm
      - run: npm ci
      - uses: changesets/action@v1
        with:
          version: npm run version-packages
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 2: Verify the YAML parses**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/version.yml')); print('OK')"
```

Expected: `OK`.

- [ ] **Step 3: Verify the file matches the spec exactly**

```bash
diff <(sed -n '/^```yaml$/,/^```$/p' docs/superpowers/specs/2026-08-28-ci-version-bump-design.md | sed '1d;$d') .github/workflows/version.yml
```

Expected: no output (files identical). If there's a diff, the workflow file has drifted from the spec — resolve by matching the spec exactly, not the other way around.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/version.yml
git commit -m "ci: add Version Packages workflow on push to dev"
```

---

### Task 2: Document the CI-driven versioning flow

**Files:**
- Modify: `CLAUDE.md` (repo root) — `## Versioning` section (workflow step 2, and the closing "See ..." line) and `## Branching` section (the "No CI or branch protection rules exist yet" line)

**Interfaces:**
- Consumes: Task 1's workflow (`.github/workflows/version.yml`) — this task documents its behavior, so Task 1 must land first.

- [ ] **Step 1: Replace `## Versioning`'s workflow step 2**

Find this paragraph in `CLAUDE.md` (currently step 2 under the `## Versioning` section's "Workflow:" list):

```markdown
2. Periodically — in practice, before a `dev → main` release PR — run `npm run version-packages` (`changeset version`) on `dev`. This bumps every workspace with a pending changeset, updates each affected workspace's `CHANGELOG.md`, and deletes the consumed changeset files. Commit the result and push directly to `dev`, or via its own small PR.
```

Replace it with:

```markdown
2. A GitHub Actions workflow (`.github/workflows/version.yml`) watches `dev`. Every push to `dev` that leaves pending changesets causes it to open (or update in place) a bot-maintained "Version Packages" PR — the diff is exactly what `npm run version-packages` (`changeset version`) would produce locally: bumped `package.json` `version` fields, updated `CHANGELOG.md` files, and the consumed changeset files removed. Review and merge that PR into `dev` whenever you're ready to include those bumps in the next `dev → main` release — this is now the normal path. `npm run version-packages` still works locally as a manual fallback (e.g. if CI is down), but you shouldn't need to run it by hand in the ordinary case.
```

- [ ] **Step 2: Update the closing "See ..." line of `## Versioning`**

Find:

```markdown
See `docs/superpowers/specs/2026-08-27-versioning-strategy-design.md` for the full design rationale and deferred items (CI automation of the version-bump step, git tagging tied to releases).
```

Replace with:

```markdown
See `docs/superpowers/specs/2026-08-27-versioning-strategy-design.md` for the original design rationale, and `docs/superpowers/specs/2026-08-28-ci-version-bump-design.md` for the CI workflow that now automates the version-bump step. Git tagging tied to releases remains deferred.
```

- [ ] **Step 3: Correct the stale CI claim in `## Branching`**

Find this line at the end of the `## Branching` section:

```markdown
No CI or branch protection rules exist yet — this is a documented convention only. See `docs/superpowers/specs/2026-08-25-branching-strategy-design.md` for the full design rationale and deferred items (CI-backed protection, per-Worker release tagging).
```

Replace with:

```markdown
No branch protection rules exist yet — merging still relies on this documented convention, not enforced checks. A CI workflow does exist as of `docs/superpowers/specs/2026-08-28-ci-version-bump-design.md` (see `## Versioning`), but it only automates version bumps; it doesn't gate merges. See `docs/superpowers/specs/2026-08-25-branching-strategy-design.md` for the full branching design rationale and remaining deferred items (CI-backed protection, per-Worker release tagging).
```

- [ ] **Step 4: Verify all three edits landed**

```bash
grep -c "A GitHub Actions workflow (\`.github/workflows/version.yml\`) watches \`dev\`" CLAUDE.md
grep -c "docs/superpowers/specs/2026-08-28-ci-version-bump-design.md" CLAUDE.md
grep -c "A CI workflow does exist as of" CLAUDE.md
```

Expected:
- First command (`A GitHub Actions workflow...`): `1` — unique to the Step 1 replacement.
- Second command (`docs/.../2026-08-28-ci-version-bump-design.md`): `2` — this path string appears once in `## Versioning`'s "See" line (Step 2) and once in `## Branching`'s corrected line (Step 3).
- Third command (`A CI workflow does exist as of`): `1` — unique to the Step 3 replacement.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: describe the CI-driven Version Packages PR flow"
```

---

### Task 3: Confirm the verification scope this plan can and can't cover locally

**Files:**
- None modified — this task is a verification checkpoint, not a code change. It exists as its own task because it records a real scope decision a reviewer needs to see explicitly, not folded silently into Task 1's commit.

**Interfaces:**
- Consumes: Task 1's workflow file, already on this branch.

The spec's verification section (#2) describes pushing a real or trial changeset and confirming the action opens a "Version Packages" PR with the expected diff — the same kind of live trial the original Changesets CLI setup used locally. That live trial isn't done as part of this plan: triggering it for real requires either pushing directly to `dev` (this repo's actual integration branch, watched by the real team — a visible, shared-state action outside a routine feature-branch push) or adding a `workflow_dispatch` trigger not in the spec's YAML solely to test on a scratch branch. Both are bigger, riskier moves than this CI-only change warrants. Instead, this task confirms everything checkable without firing a live run, and the live "PR actually opens with the right diff" confirmation happens naturally and for free the first time any future branch lands a real changeset on `dev` after this branch merges.

- [ ] **Step 1: Confirm no pending changesets currently exist on `dev`**

```bash
ls .changeset/*.md 2>/dev/null || echo NONE_PENDING
```

Expected: `NONE_PENDING` (only `.changeset/config.json` and `.changeset/README.md` exist — PR #21 consumed the only changeset file that ever existed, via its own `changeset version` run). This confirms the workflow's first real trigger, once this branch merges to `dev`, will observe zero pending changesets and correctly no-op rather than opening an empty or malformed PR.

- [ ] **Step 2: Re-confirm the workflow YAML is well-formed** (same check as Task 1 Step 2, re-run here as this task's own independently-verifiable checkpoint)

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/version.yml')); print('OK')"
```

Expected: `OK`. Full confirmation that GitHub itself accepts the workflow (green in the Actions tab, "Version Packages" listed under `gh workflow list`) becomes checkable once this branch's PR merges into `dev` and produces the workflow's first real push-triggered run.

- [ ] **Step 3: No commit** — this task is verification only; nothing here modifies tracked files.
