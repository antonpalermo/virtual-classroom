# CI version-bump design

## Goals

- Automate the version-bump step of the Changesets workflow set up in [2026-08-27-versioning-strategy-design.md](2026-08-27-versioning-strategy-design.md), which explicitly deferred this: *"CI automation of the version-bump step (an auto-opened 'Version Packages' PR). No CI pipeline exists yet in this repo; this can be layered on later once one does."*
- Bump versions on `dev` — the integration branch — before they ever reach `main`, so `main` is never pushed to directly by CI. This preserves the existing branching rule: *"`main` ... Never pushed to directly; only receives PRs from `dev` or from a hotfix branch."*
- Keep a human merge-click in the loop. `dev` has no branch protection today, so an automated bump should land as a reviewable PR, not a direct commit.
- Match the standard Changesets CI recipe rather than hand-rolling equivalent logic.

## Non-goals

- Publishing to npm, or any `NPM_TOKEN`/registry configuration. Every workspace is `private: true` and deployed as a Cloudflare Worker; `changeset publish` is never used (unchanged from the versioning-strategy design).
- Deploying, building, or any lint/test CI gate. This workflow's only job is opening/refreshing the version-bump PR; general CI (tests, typecheck, lint-on-PR) is a separate, unrequested concern and out of scope here.
- Git tagging or per-Worker release tracking. Already deferred by the versioning-strategy design; unchanged.
- Branch protection rules for `dev` or `main`. Still a documented convention only, per the branching-strategy design's deferred items.

## Design

### Tool: `changesets/action`

[`changesets/action@v1`](https://github.com/changesets/action), maintained by the Changesets team, is the standard tool for this exact job: watch a branch, and if pending `.changeset/*.md` files exist, open (or update in place) a bot-maintained "Version Packages" pull request that runs the repo's version script. It already handles idempotency (updating the existing PR rather than duplicating it across pushes), multi-package bumps, and PR body formatting — no custom scripting to maintain.

This repo's case is simpler than the action's typical setup:

- No `publish` input is configured. The action only ever creates/updates the version PR and stops there — it never attempts to publish, since every workspace is `private: true` and unpublished.
- No `NPM_TOKEN` secret is needed, for the same reason.
- The default `GITHUB_TOKEN`, scoped with `contents: write` and `pull-requests: write` permissions, is sufficient — everything stays inside the repo.

### Workflow: `.github/workflows/version.yml`

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

Notes on specific choices:

- `on: push: branches: [dev]` — matches `baseBranch: "dev"` in `.changeset/config.json`. Every push to `dev` (i.e., every feature/fix/chore PR merge) re-evaluates whether pending changesets exist.
- `concurrency` — keyed on the ref, so two pushes to `dev` in quick succession don't race two runs against the same "Version Packages" PR branch. `cancel-in-progress: false` since letting the later run simply update the PR again is safer than cancelling a mid-flight commit.
- `version: npm run version-packages` — reuses the exact script Task 1 of the versioning-strategy plan added (`"version-packages": "changeset version"`), so CI and a manual local run do the same thing.
- No `publish` input — see Non-goals. Omitting it is what keeps this action from ever attempting an npm publish.
- `node-version-file: package.json` — reads the root `package.json`'s `engines.node` (already repo convention via Turborepo/Volta-style pinning if present; falls back gracefully if absent) rather than hardcoding a version in the workflow.

### Behavior / workflow

1. A `feature/*`/`fix/*`/`chore/*` PR — that included a `.changeset/*.md` file per the existing Changesets workflow — merges into `dev`.
2. The push to `dev` triggers this workflow. `changesets/action` finds the pending changeset file(s) and opens (or updates) a PR titled "Version Packages" from a bot-managed branch (`changeset-release/dev`) targeting `dev`. That PR's diff is exactly what `npm run version-packages` would have produced locally: bumped `package.json` `version` fields, updated `CHANGELOG.md` files, and the consumed changeset files deleted.
3. Whoever is preparing a release reviews and merges that PR into `dev` like any other PR, whenever they're ready — this is the moment that used to be the manual `npm run version-packages` step in the original design. The script stays in `package.json` as a manual fallback (e.g., for local testing, or if CI is ever down), but CI is the normal path now.
4. Nothing here touches `main`. The bumped versions simply exist on `dev` by the time the next `dev → main` release PR is opened, same as before — only the mechanism that puts them there changed from manual to bot-assisted.
5. If a push to `dev` has no pending changesets (e.g., docs-only PRs, or right after the Version Packages PR itself was just merged), the action is a no-op: no PR is opened or updated.

### Sequencing dependency

This workflow's `version: npm run version-packages` step depends on the `version-packages` script and `.changeset/config.json` added by the versioning-strategy work (PR #21), which is not yet merged into `dev` as of this design. This workflow cannot do anything useful until that PR merges — the implementation plan for this design should either wait for PR #21 to land first, or land this workflow file in the same window and confirm both are present on `dev` before relying on it.

### Documentation

Root `CLAUDE.md`'s `## Versioning` section (added by the versioning-strategy work) is updated to describe the bot-driven PR flow in place of "run this manually," and to note that this is the repo's first CI workflow — worth calling out since `## Branching` currently states flatly that "No CI or branch protection rules exist yet."

## Testing / verification

This is CI configuration, not application code. Verification is:

1. The workflow file is valid YAML and passes `actionlint` if available, or at minimum GitHub's own workflow syntax check (visible in the Actions tab / PR checks once pushed).
2. End-to-end: push a real or trial changeset to `dev` (or a branch simulating it) and confirm the action opens a "Version Packages" PR with the expected diff (bumped `package.json`/`CHANGELOG.md`, changeset file removed) — mirroring the throwaway-changeset verification already done for the local CLI in the versioning-strategy work, but now via the Actions run rather than a local `npx changeset version`.
3. `CLAUDE.md`'s updated `## Versioning` section reads clearly and matches this spec.
