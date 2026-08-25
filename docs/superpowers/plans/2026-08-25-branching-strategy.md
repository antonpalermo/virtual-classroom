# Branching Strategy Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Document the repo's branching strategy (main/dev/feature-branch model) as a `## Branching` section in the root `CLAUDE.md`.

**Architecture:** This is a documentation-only change — one new Markdown section appended to `/home/sono/virtual-classroom/CLAUDE.md`. No code, no CI, no branch protection rules.

**Tech Stack:** Markdown.

**Spec:** `docs/superpowers/specs/2026-08-25-branching-strategy-design.md`

## Global Constraints

- No CI, no GitHub branch protection rules, no release/versioning tooling — documentation only (spec's Non-goals / Explicitly deferred sections).
- No ticket-ID prefix in branch names — no issue tracker in use (spec's Naming convention section).
- Squash-merge for `feature/fix/chore → dev`; regular merge for `dev → main` (spec's Workflow section).

---

### Task 1: Add `## Branching` section to root `CLAUDE.md`

**Files:**
- Modify: `/home/sono/virtual-classroom/CLAUDE.md` (append new section at end of file, after the existing `## TypeScript config layout` section which currently ends at line 49)

**Interfaces:**
- Consumes: nothing (pure documentation, no code interfaces).
- Produces: nothing consumed by other tasks — this is the only task in the plan.

- [ ] **Step 1: Append the `## Branching` section**

Add the following to the end of `/home/sono/virtual-classroom/CLAUDE.md` (after the `## TypeScript config layout` section, separated by one blank line):

```markdown

## Branching

Two-tier trunk model: `main` is production-ready, `dev` is the default integration branch, short-lived branches feed into `dev`.

- **`main`** — production-ready, deployable at any time. Never pushed to directly; only receives PRs from `dev` or from a hotfix branch (see below).
- **`dev`** — the default branch. Branch off this for day-to-day work.
- **`feature/*`, `fix/*`, `chore/*`** — short-lived, cut from `dev`, merged back into `dev` via PR. kebab-case names, e.g. `feature/screen-share`, `fix/socket-reconnect`, `chore/upgrade-wrangler`. No ticket-ID prefix (no issue tracker in use).

Workflow:

1. Branch off `dev`: `git checkout -b feature/x dev`
2. Commit and push.
3. PR `feature/x → dev`, squash-merge.
4. When `dev` has a production-ready batch of work, PR `dev → main`, regular merge (not squash) so `main` keeps the individual feature commits.

Hotfix exception — for urgent production bugs that can't wait for `dev` to be release-ready:

1. Branch `fix/<short-desc>` off `main` (not `dev`).
2. PR it into `main` and merge.
3. Immediately merge `main` back into `dev` so `dev` doesn't drift.

No CI or branch protection rules exist yet — this is a documented convention only. See `docs/superpowers/specs/2026-08-25-branching-strategy-design.md` for the full design rationale and deferred items (CI-backed protection, per-Worker release tagging).
```

- [ ] **Step 2: Verify the section renders correctly**

Run: `grep -n "^## " /home/sono/virtual-classroom/CLAUDE.md`
Expected: five section headers listed, with `## Branching` as the last one.

Read the file back and confirm the section reads clearly and matches the spec (branch structure, naming convention, workflow, hotfix exception, deferred items all present).

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document branching strategy in CLAUDE.md"
```
