# PR Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four type-specific GitHub PR templates under `.github/PULL_REQUEST_TEMPLATE/` so GitHub shows an automatic template picker (Feature, Bug Fix, Documentation, Chore/Maintenance) when opening a PR against this repo.

**Architecture:** Four independent, same-shape Markdown files in one new directory. No code, no chooser config needed (GitHub auto-detects multiple files in `PULL_REQUEST_TEMPLATE/`).

**Tech Stack:** Markdown.

**Spec:** `docs/superpowers/specs/2026-08-25-pr-templates-design.md`

## Global Constraints

- Directory is `.github/PULL_REQUEST_TEMPLATE/` (plural `TEMPLATE`, no trailing `S` — this is GitHub's documented convention, distinct from `ISSUE_TEMPLATE`) (spec's "Mechanism" section).
- No `config.yml` or other chooser configuration file — not needed for PR templates (spec's "Non-goals" section).
- The commit-messages skill link in every template must resolve to `.claude/skills/commit-messages/SKILL.md` from `.github/PULL_REQUEST_TEMPLATE/<file>.md`, i.e. `../../.claude/skills/commit-messages/SKILL.md` (two levels up to repo root, then into `.claude/`).
- The branching-strategy spec link (in `feature.md`, `bug_fix.md`, `chore.md`) must resolve to `docs/superpowers/specs/2026-08-25-branching-strategy-design.md` from the same location, i.e. `../../docs/superpowers/specs/2026-08-25-branching-strategy-design.md`.
- Workspace checklist values are exactly: `client`, `realtime`, `web-standards`, `config-typescript`, `root (not scoped to one workspace)` — matching the commit-messages skill's scope list (spec's "Common backbone" section).

---

### Task 1: Create the four PR template files

**Files:**
- Create: `.github/PULL_REQUEST_TEMPLATE/feature.md`
- Create: `.github/PULL_REQUEST_TEMPLATE/bug_fix.md`
- Create: `.github/PULL_REQUEST_TEMPLATE/documentation.md`
- Create: `.github/PULL_REQUEST_TEMPLATE/chore.md`

**Interfaces:**
- Consumes: nothing (pure documentation, only task in this plan).
- Produces: nothing consumed by other tasks. All four files are independent of each other and of any code.

This is one task covering four small, same-shape files (batched per the "small same-shape work" pattern — same kind of edit repeated, no per-file judgment needed) rather than four separate tasks.

- [ ] **Step 1: Create the directory and write all four files**

Write the following exact content to `.github/PULL_REQUEST_TEMPLATE/feature.md`:

```markdown
## Description

<!-- What does this PR add, and why? -->

## Related issue

Closes #

## What's new

-
-

## Workspace(s) affected

- [ ] client
- [ ] realtime
- [ ] web-standards
- [ ] config-typescript
- [ ] root (not scoped to one workspace)

## Screenshots / recording

<!-- If this changes UI or user-visible behavior, include a screenshot or recording. Delete this section if not applicable. -->

## How was this tested

<!-- Manual verification steps — there's no CI yet, so this is the record of how you know it works. -->

## Checklist

- [ ] Self-reviewed the diff
- [ ] Follows the [branching strategy](../../docs/superpowers/specs/2026-08-25-branching-strategy-design.md)
- [ ] Commit messages follow the [commit-messages skill](../../.claude/skills/commit-messages/SKILL.md)
- [ ] `npm run lint` passes locally
- [ ] `npm run check-types` passes locally
```

Write the following exact content to `.github/PULL_REQUEST_TEMPLATE/bug_fix.md`:

```markdown
## Description

<!-- What was broken, and what does this PR fix? -->

## Related issue

Fixes #

## Root cause

<!-- What was actually wrong? -->

## How to reproduce (before fix)

1.

## Workspace(s) affected

- [ ] client
- [ ] realtime
- [ ] web-standards
- [ ] config-typescript
- [ ] root (not scoped to one workspace)

## How was this tested

<!-- Manual verification steps confirming the bug is fixed and nothing else broke. -->

## Checklist

- [ ] Self-reviewed the diff
- [ ] Follows the [branching strategy](../../docs/superpowers/specs/2026-08-25-branching-strategy-design.md)
- [ ] Commit messages follow the [commit-messages skill](../../.claude/skills/commit-messages/SKILL.md)
- [ ] `npm run lint` passes locally
- [ ] `npm run check-types` passes locally
```

Write the following exact content to `.github/PULL_REQUEST_TEMPLATE/documentation.md`:

```markdown
## Description

<!-- What documentation changed, and why? -->

## What changed

-
-

## Checklist

- [ ] Self-reviewed the diff
- [ ] Links checked (relative paths resolve, no broken references)
- [ ] Commit messages follow the [commit-messages skill](../../.claude/skills/commit-messages/SKILL.md)
```

Write the following exact content to `.github/PULL_REQUEST_TEMPLATE/chore.md`:

```markdown
## Description

<!-- What does this PR change (tooling, deps, config, cleanup), and why? -->

## What changed

-
-

## Behavior change?

- [ ] No — this is purely internal (tooling/deps/cleanup), no functional change
- [ ] Yes — describe the behavior change: 

## Workspace(s) affected

- [ ] client
- [ ] realtime
- [ ] web-standards
- [ ] config-typescript
- [ ] root (not scoped to one workspace)

## How was this tested

<!-- Manual verification steps — there's no CI yet, so this is the record of how you know it works. -->

## Checklist

- [ ] Self-reviewed the diff
- [ ] Follows the [branching strategy](../../docs/superpowers/specs/2026-08-25-branching-strategy-design.md)
- [ ] Commit messages follow the [commit-messages skill](../../.claude/skills/commit-messages/SKILL.md)
- [ ] `npm run lint` passes locally
- [ ] `npm run check-types` passes locally
```

- [ ] **Step 2: Verify all four files exist with correct structure**

Run: `ls .github/PULL_REQUEST_TEMPLATE/ && grep -c "^## " .github/PULL_REQUEST_TEMPLATE/*.md`

Expected: all four filenames listed (`bug_fix.md`, `chore.md`, `documentation.md`, `feature.md`); `feature.md` has 7 section headers (`Description`, `Related issue`, `What's new`, `Workspace(s) affected`, `Screenshots / recording`, `How was this tested`, `Checklist`), `bug_fix.md` has 7 (`Description`, `Related issue`, `Root cause`, `How to reproduce (before fix)`, `Workspace(s) affected`, `How was this tested`, `Checklist`), `chore.md` has 6 (`Description`, `What changed`, `Behavior change?`, `Workspace(s) affected`, `How was this tested`, `Checklist`), `documentation.md` has 3 (`Description`, `What changed`, `Checklist`).

- [ ] **Step 3: Verify the relative links resolve**

Run:
```bash
test -f .github/PULL_REQUEST_TEMPLATE/../../.claude/skills/commit-messages/SKILL.md && echo "commit-messages link OK"
test -f .github/PULL_REQUEST_TEMPLATE/../../docs/superpowers/specs/2026-08-25-branching-strategy-design.md && echo "branching-strategy link OK"
```

Expected: both lines print `... OK`. If either fails, the link path is wrong — fix it before proceeding (the correct paths are given verbatim in Step 1's file contents above; do not invent an alternative path).

- [ ] **Step 4: Read each file back and confirm it matches the spec**

Read `docs/superpowers/specs/2026-08-25-pr-templates-design.md`'s "Full template content" section and diff each of the four created files against it — content must match exactly (this plan's Step 1 content was copied verbatim from that spec section; any mismatch is a transcription error to fix).

- [ ] **Step 5: Commit**

`.github/` is repo-root tooling, not any one workspace — per the commit-messages skill's no-scope rule for indivisible root-level changes, this commit has no scope:

```bash
git add .github/PULL_REQUEST_TEMPLATE/
git commit -m "$(cat <<'EOF'
chore: add PR templates

- add .github/PULL_REQUEST_TEMPLATE/{feature,bug_fix,documentation,chore}.md
- GitHub auto-shows a template picker across these four on new PRs
EOF
)"
```
