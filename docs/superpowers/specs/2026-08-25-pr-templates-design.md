# PR Templates Design

## Context

This is a Turborepo monorepo (`virtual-classroom`) with four workspaces (`apps/worker-client`, `apps/worker-realtime`, `packages/web-standards`, `packages/config-typescript`), a GitHub remote (`antonpalermo/virtual-classroom`), and `gh` CLI available. There's no `.github/` directory yet, so no PR template exists. There's also no CI pipeline, so PR review currently relies entirely on the description the author writes and manual verification.

The repo already has two related conventions established this session: a two-tier trunk branching strategy (`docs/superpowers/specs/2026-08-25-branching-strategy-design.md`, documented in root `CLAUDE.md`) and a Conventional Commits message convention (`.claude/skills/commit-messages/SKILL.md`). This design should be consistent with both — PRs are how `feature/fix/chore` branches land on `dev`, and on `dev` land on `main`.

## Goals

- Give the repo a PR template that captures industry-standard sections (description, related issue, testing, checklist) without the ceremony a full engineering org would need.
- Separate templates per PR type — feature, bug fix, documentation, chore/maintenance — each tailored to what's actually relevant for that kind of change, using GitHub's native multi-template picker.
- Fit the monorepo shape: let an author flag which workspace(s) a PR touches, useful given the two apps deploy independently.
- Compensate for the lack of CI by making manual verification an explicit, required part of the template (a "how was this tested" section that has to be filled in).

## Non-goals

- CI integration (e.g. a status check that verifies the template was filled in) — no CI pipeline exists yet.
- Issue templates — out of scope, this is PR templates only.
- A default/fallback `.github/pull_request_template.md` outside the multi-template directory — GitHub only falls back to that file when zero templates exist in `PULL_REQUEST_TEMPLATE/`; since this design always provides four, the picker is always shown and no fallback is needed.

## Design

### Mechanism

GitHub shows an automatic template picker when multiple files exist in `.github/PULL_REQUEST_TEMPLATE/` (plural `TEMPLATE`, no `S` — this is the officially documented directory name, distinct from `ISSUE_TEMPLATE`). No `config.yml` or other chooser configuration is needed for PR templates (unlike issue templates). Four files:

- `.github/PULL_REQUEST_TEMPLATE/feature.md`
- `.github/PULL_REQUEST_TEMPLATE/bug_fix.md`
- `.github/PULL_REQUEST_TEMPLATE/documentation.md`
- `.github/PULL_REQUEST_TEMPLATE/chore.md`

### Common backbone

Every template shares this shape, trimmed to what's useful for a solo/small-team repo with no CI:

- **Description** — what changed and why.
- **Related issue** — `Closes #` / `Fixes #`, optional (no issue tracker mandated yet, but the field exists for when one is used).
- **Workspace(s) affected** — a checklist: `client`, `realtime`, `web-standards`, `config-typescript`, or `root` (not scoped to one workspace). Mirrors the scope values from the commit-messages skill.
- **How was this tested** — required manual verification steps, since there's no CI to lean on.
- **Checklist** — self-reviewed, follows the branching (`docs/superpowers/specs/2026-08-25-branching-strategy-design.md`) and commit-message (`.claude/skills/commit-messages/SKILL.md`) conventions, `npm run lint` and `npm run check-types` pass locally.

### Per-type differences

- **`feature.md`** — adds "What's new" (bullet list of concrete additions) and "Screenshots / recording" (relevant since the client is a video-conferencing UI — visual changes are common).
- **`bug_fix.md`** — adds "Root cause" (what was actually wrong) and "How to reproduce (before fix)" (steps that demonstrated the bug).
- **`documentation.md`** — lighter weight: drops "Workspace(s) affected" and "How was this tested" (not usually applicable to doc-only changes), keeps Description, "What changed" (bullets), and the checklist.
- **`chore.md`** — adds "Behavior change?" (Yes/No line) — chores shouldn't change functionality, so this makes it explicit when one does and forces a call-out if so.

### Full template content

**`feature.md`:**

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

**`bug_fix.md`:**

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

**`documentation.md`:**

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

**`chore.md`:**

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

## Testing / verification

This is documentation/config only, no application code. Verification is: all four files exist at the correct paths under `.github/PULL_REQUEST_TEMPLATE/`, each matches this spec's content, and the relative links inside each (to the branching-strategy spec and the commit-messages skill) resolve correctly from `.github/PULL_REQUEST_TEMPLATE/<file>.md`. Full end-to-end verification (confirming GitHub's picker actually appears) requires opening a real PR against this repo's GitHub remote, which is outside what this implementation task itself needs to do — noted as a manual follow-up check for the user.
