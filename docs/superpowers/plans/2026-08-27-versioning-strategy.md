# Versioning Strategy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every workspace in this monorepo (3 apps + 2 packages, and any added later) a real, independently-bumped `version`, driven by Changesets, with no CI required.

**Architecture:** Install `@changesets/cli` at the repo root, scaffold and configure `.changeset/config.json` for independent per-workspace versioning against `baseBranch: "dev"`, verify the bump/changelog/internal-dependency-update mechanics work end-to-end with a throwaway changeset (then revert it), and document the resulting `npx changeset` → `npx changeset version` workflow in root `CLAUDE.md`.

**Tech Stack:** `@changesets/cli` (npm workspaces monorepo tool), npm workspaces, Biome (formats staged files via the existing Husky/lint-staged pre-commit hook — no action needed, it runs automatically).

**Spec:** [docs/superpowers/specs/2026-08-27-versioning-strategy-design.md](../specs/2026-08-27-versioning-strategy-design.md)

## Global Constraints

- Versioning is independent per workspace — no fixed/linked groups (`"fixed": []`, `"linked": []`).
- `baseBranch` in `.changeset/config.json` must be `"dev"` (this repo's default integration branch), not the Changesets default of `"main"`.
- `updateInternalDependencies` must be `"patch"` — kept for forward compatibility (it governs how an already-scheduled dependent's dependency-range string and changelog entry are written), but with every internal dependency in this repo declared as `"*"`, it never causes a dependent to be scheduled for release in the first place — see Task 2.
- `.changeset/config.json` must set `"privatePackages": { "version": true, "tag": false }`. Every workspace is `private: true`, and Changesets' `shouldSkipPackage` (confirmed in the installed `@changesets/should-skip-package` source) skips versioning any package with `private: true` unless this is set — without it, `changeset version` silently no-ops on this entire repo despite reporting success. `tag: false` matches the deferred git-tagging decision below.
- `changeset publish` is never used and no publish/release script is added — every workspace is `private: true`, deployed as a Cloudflare Worker or consumed only in-repo, never published to npm.
- No per-package allowlist anywhere — Changesets must discover workspaces via the root `workspaces` field (`["apps/*", "packages/*"]`) so new workspaces participate automatically.

---

### Task 1: Install and configure Changesets

**Files:**
- Modify: `package.json` (repo root) — add `@changesets/cli` devDependency, add `changeset` and `version-packages` scripts
- Modify: `package-lock.json` (updated automatically by `npm install`)
- Create: `.changeset/config.json` (scaffolded by `npx changeset init`, then edited)
- Create: `.changeset/README.md` (scaffolded by `npx changeset init`, no edits needed)

**Interfaces:**
- Produces: `npm run changeset` (→ `changeset` CLI, interactive), `npm run version-packages` (→ `changeset version`, applies pending bumps). Task 2 and Task 3 both depend on these existing and being correctly configured.

- [ ] **Step 1: Install `@changesets/cli`**

Run from the repo root:

```bash
npm install --save-dev @changesets/cli
```

- [ ] **Step 2: Verify the install**

```bash
npm pkg get devDependencies['@changesets/cli']
```

Expected: prints a version string (e.g. `"^2.29.7"`), not empty/undefined.

- [ ] **Step 3: Scaffold the Changesets config**

```bash
npx changeset init
```

- [ ] **Step 4: Verify the scaffold**

```bash
test -f .changeset/config.json && test -f .changeset/README.md && echo OK
```

Expected: `OK`.

- [ ] **Step 5: Edit `.changeset/config.json` to match this repo's requirements**

`changeset init` writes `baseBranch: "main"` by default; every other default already matches this repo's requirements (default changelog generator, empty `fixed`/`linked`, `updateInternalDependencies: "patch"`, `access: "restricted"`, empty `ignore`). Edit the file so it reads exactly:

```json
{
    "$schema": "https://unpkg.com/@changesets/config/schema.json",
    "changelog": "@changesets/cli/changelog",
    "commit": false,
    "fixed": [],
    "linked": [],
    "access": "restricted",
    "baseBranch": "dev",
    "updateInternalDependencies": "patch",
    "ignore": [],
    "privatePackages": {
        "version": true,
        "tag": false
    }
}
```

- [ ] **Step 6: Verify the config**

```bash
cat .changeset/config.json
```

Expected: output matches Step 5 exactly (in particular `"baseBranch": "dev"`, not `"main"`).

- [ ] **Step 7: Add root `package.json` scripts**

Add two entries to the `"scripts"` object in the root `package.json`, after the existing `"prepare": "husky"` entry:

```json
"changeset": "changeset",
"version-packages": "changeset version"
```

- [ ] **Step 8: Verify the scripts are wired correctly**

```bash
npm pkg get scripts.changeset scripts.version-packages
```

Expected:

```json
{"scripts.changeset":"changeset","scripts.version-packages":"changeset version"}
```

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json .changeset/config.json .changeset/README.md
git commit -m "chore: install and configure Changesets"
```

---

### Task 2: Verify the versioning setup end-to-end with a throwaway changeset

**Files:**
- Create (temporary, reverted at the end of this task): `.changeset/trial-verify-setup.md`
- Modify (temporary, reverted at the end of this task): `packages/web-standards/package.json`
- Create (temporary, deleted at the end of this task): `packages/web-standards/CHANGELOG.md`

**Interfaces:**
- Consumes: `npm run version-packages` from Task 1.
- Produces: nothing persists — this task's job is to prove Task 1's config works, then leave the working tree exactly as Task 1's commit left it.

`apps/worker-realtime/package.json` declares `"@capstone/standards": "*"` under `dependencies`. `"*"` is satisfied by every version, so Changesets never schedules `@capstone/realtime` for a release on a `@capstone/standards` bump — `updateInternalDependencies` (confirmed against the installed `@changesets/assemble-release-plan` source) only rewrites an *already-scheduled* dependent's dependency-range string and changelog entry; it does not decide whether a dependent gets scheduled in the first place. That decision is purely `!semverSatisfies(nextVersion, versionRange)`, which is never true for a `"*"` range. So bumping `@capstone/standards` here correctly stays isolated to that one workspace — this is the expected behavior, not a gap, and it's the right way to confirm this repo's independent-versioning goal actually holds: an internal dependency changing does NOT ripple a version bump through workspaces that didn't themselves change.

- [ ] **Step 1: Write a trial changeset file**

Create `.changeset/trial-verify-setup.md`:

```markdown
---
"@capstone/standards": patch
---

Trial changeset used only to verify the versioning setup end-to-end.
```

- [ ] **Step 2: Apply the version bump**

```bash
npx changeset version
```

- [ ] **Step 3: Verify `@capstone/standards` bumped directly**

```bash
npm pkg get version -w packages/web-standards
```

Expected: `"0.0.1"` (was `"0.0.0"`).

```bash
test -f packages/web-standards/CHANGELOG.md && echo OK
```

Expected: `OK`.

- [ ] **Step 4: Verify `@capstone/realtime` was NOT bumped, despite depending on `@capstone/standards`**

```bash
npm pkg get version -w apps/worker-realtime
```

Expected: `"0.0.0"` (unchanged) — its `"@capstone/standards": "*"` dependency range is satisfied by any version, so Changesets never schedules it for release. This confirms independent versioning actually holds: an internal dependency change doesn't ripple a bump into a workspace whose own code didn't change.

```bash
test -f apps/worker-realtime/CHANGELOG.md && echo EXISTS || echo ABSENT
```

Expected: `ABSENT` (the file should not exist — `test -f` fails, so the `&&` branch is skipped and the `||` branch fires).

- [ ] **Step 5: Verify remaining unrelated workspaces were left untouched**

```bash
npm pkg get version -w apps/worker-client -w apps/worker-auth -w packages/config-typescript
```

Expected: all three still report `"0.0.0"` — none depends on `@capstone/standards`, so none should have moved.

- [ ] **Step 6: Verify the trial changeset file was consumed**

```bash
test -f .changeset/trial-verify-setup.md && echo STILL_PRESENT || echo CONSUMED
```

Expected: `CONSUMED` (`changeset version` deletes changeset files it applies).

- [ ] **Step 7: Revert the trial — restore the working tree to Task 1's committed state**

```bash
git checkout -- packages/web-standards/package.json
rm -f packages/web-standards/CHANGELOG.md
git status --porcelain
```

Expected: `git status --porcelain` prints nothing (clean working tree, matching the commit from Task 1). No commit for this task — its purpose was verification, and it leaves no trace.

---

### Task 3: Document the versioning workflow in `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md` (repo root) — append a `## Versioning` section after the existing `## Branching` section (currently the last section in the file, ending at line 73)

**Interfaces:**
- Consumes: the workflow established in Task 1 (`npm run changeset`, `npm run version-packages`) and the spec at `docs/superpowers/specs/2026-08-27-versioning-strategy-design.md`.

- [ ] **Step 1: Append the new section**

Add this to the end of `CLAUDE.md` (after the final paragraph of the `## Branching` section, which currently ends with `...deferred items (CI-backed protection, per-Worker release tagging).`):

```markdown

## Versioning

Every workspace's `package.json` carries a real, independently-bumped `version` — no workspace stays pinned at `0.0.0` forever. Versioning is handled by [Changesets](https://github.com/changesets/changesets) (`@changesets/cli`), configured in `.changeset/config.json`. It reads the root `workspaces` field, so any new workspace under `apps/*` or `packages/*` participates automatically — no config change needed.

Nothing here is published to npm — every workspace is `private: true` and deployed as a Cloudflare Worker (or consumed only within the monorepo). `changeset publish` is never used; the version bump itself (and its `CHANGELOG.md` entry) is the deliverable, a record of what shipped in each independently-deployed Worker.

Workflow:

1. On a feature/fix/chore branch, after changing one or more workspaces, run `npx changeset`. Pick the affected workspace(s), a bump type (patch/minor/major) for each, and write a short summary. Commit the generated `.changeset/*.md` file alongside the code change and include it in the normal PR into `dev`.
2. Periodically — in practice, before a `dev → main` release PR — run `npm run version-packages` (`changeset version`) on `dev`. This bumps every workspace with a pending changeset, updates each affected workspace's `CHANGELOG.md`, and deletes the consumed changeset files. Commit the result and push directly to `dev`, or via its own small PR.

See `docs/superpowers/specs/2026-08-27-versioning-strategy-design.md` for the full design rationale and deferred items (CI automation of the version-bump step, git tagging tied to releases).
```

- [ ] **Step 2: Verify the section was added correctly**

```bash
grep -c '^## Versioning' CLAUDE.md
```

Expected: `1`.

```bash
tail -15 CLAUDE.md
```

Expected: ends with the `See docs/superpowers/specs/2026-08-27-versioning-strategy-design.md...` line from Step 1.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document the Changesets versioning workflow"
```
