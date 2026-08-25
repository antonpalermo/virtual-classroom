---
name: opening-a-pr
description: Use when opening a pull request in this repository, before running `gh pr create` — defines which template to use, which base branch to target, and what a checked checklist box means.
---

# Opening a PR

## Pick the template

| Change is... | Template |
|---|---|
| Fixing broken behavior | `.github/PULL_REQUEST_TEMPLATE/bug_fix.md` |
| Adding new functionality | `.github/PULL_REQUEST_TEMPLATE/feature.md` |
| Tooling, deps, config, cleanup — no functional change | `.github/PULL_REQUEST_TEMPLATE/chore.md` |
| Docs only | `.github/PULL_REQUEST_TEMPLATE/documentation.md` |

Pass it with `--body-file`, not a hand-retyped copy.

## Pick the base branch

Per the branching strategy in the root `CLAUDE.md`:

| Branch prefix | Base |
|---|---|
| `feature/*`, `fix/*`, `chore/*` | `dev` |
| `fix/*` cut from `main` (hotfix) | `main`, then merge `main` back into `dev` |
| `dev` (promoting a release batch) | `main`, regular merge — not squash |

## Fill every section — no dangling placeholders

This repo has no issue tracker (see CLAUDE.md branching section). The `bug_fix.md` and `feature.md` templates still carry a `Related issue` / `Fixes #` section — **delete that section** rather than leaving `Fixes #` with no number. Same rule for any other template placeholder comment (`<!-- ... -->`) or checklist item that doesn't apply: remove it, don't leave it dangling.

`Workspace(s) affected` must be checked against the real workspace list (`client`, `realtime`, `web-standards`, `config-typescript`, `root`) for *this* change — not left as an unexamined copy of the template.

## A checked box is evidence, not intent

Check a checklist box only for something that is true right now, verified in this session — never for something you intend to be true or assume is true.

- `npm run lint` / `npm run check-types` — run them and see them pass in this session before checking. Not run yet → leave unchecked.
- `Self-reviewed the diff` — check only after actually reading `git diff` for the branch being merged.
- `Commit messages follow the commit-messages skill` — if while preparing the PR you notice a commit that violates it (e.g. a change spanning multiple workspaces committed under one scope), fix the commit before opening the PR (amend/rebase), or leave the box unchecked and say why in the description. Never check a box while a violation you found is sitting unfixed elsewhere in the same PR.

## Title format

Same format as the commit-messages skill: `<type>(<scope>): <summary>`, e.g. `fix(realtime): prevent duplicate socket registration on reconnect`. Root-level, non-scoped changes drop the scope: `docs: document branching strategy in CLAUDE.md`.
