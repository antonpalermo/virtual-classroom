# Versioning strategy design

## Goals

- Give every workspace (apps and packages, present and future) a real, moving `version` in its `package.json` instead of a permanent `0.0.0`.
- Bump versions independently per workspace — a change to `worker-client` shouldn't bump `worker-auth`'s version, matching the fact that the three Workers deploy independently.
- Keep the workflow low-ceremony and require no CI, matching the repo's current no-CI state (see [2026-08-25-branching-strategy-design.md](2026-08-25-branching-strategy-design.md), which explicitly deferred this exact item: *"Per-app release/versioning strategy for the two independently deployed Workers"*).
- New workspaces added later under `apps/*` or `packages/*` should participate automatically, with no config change required.

## Non-goals

- Publishing any package to npm. Every workspace is `private: true` and deployed as a Cloudflare Worker (or consumed only within the monorepo); `changeset publish` is never used.
- CI automation of the version-bump step (an auto-opened "Version Packages" PR). No CI pipeline exists yet in this repo; this can be layered on later once one does.
- Git tagging or per-Worker release tracking tied to version bumps. Same reasoning — revisit once deploys are automated.
- A fixed/lockstep versioning scheme. Independent versioning was chosen deliberately since the Workers deploy independently.

## Design

### Tool: Changesets

[Changesets](https://github.com/changesets/changesets) (`@changesets/cli`) is added as a root devDependency. It works entirely from `.changeset/*.md` files that describe pending changes, and reads the root `workspaces` field (`["apps/*", "packages/*"]`) to discover packages — so it automatically covers every current workspace and any added later, with no per-package allowlist to maintain.

Two commands matter for this repo; a third (`changeset publish`) is intentionally never used:

- `npx changeset` — interactively records a pending change: which workspace(s) it touches, the bump type (patch/minor/major) for each, and a short summary. Writes one markdown file under `.changeset/`.
- `npx changeset version` — consumes every pending changeset file, bumps the affected workspaces' `package.json` `version` fields (plus any dependent workspace, per `updateInternalDependencies` below), writes/updates each affected workspace's `CHANGELOG.md`, and deletes the consumed changeset files.

### Configuration

`npx changeset init` scaffolds `.changeset/config.json` and `.changeset/README.md`. The config is adjusted from its defaults as follows:

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

- `baseBranch: "dev"` — matches this repo's default integration branch (see the branching strategy doc); Changesets uses this to diff for pending changesets.
- `changelog: "@changesets/cli/changelog"` — the default, dependency-free changelog generator. `@changesets/changelog-github` is not used since it needs a GitHub token/repo context this no-CI setup doesn't have.
- `fixed: []`, `linked: []` — no grouping; every workspace versions independently.
- `updateInternalDependencies: "patch"` — controls how an *already-scheduled* dependent's dependency-range string and changelog entry get written when it releases alongside a bumped internal dependency. It does **not** decide whether a dependent gets scheduled for release at all: that's decided purely by whether the dependent's existing semver range on the bumped package is still satisfied (confirmed against the installed `@changesets/assemble-release-plan` source). Every internal dependency in this repo is declared as `"*"` (e.g. `apps/worker-realtime`'s `"@capstone/standards": "*"`), which is satisfied by any version — so under this repo's current dependency ranges, bumping one workspace never cascades a release into another. This is set for forward compatibility (it costs nothing and starts working automatically if a workspace ever pins an internal dependency to a narrower range) but has no effect today, and that's the correct outcome given the independent-versioning goal above: a workspace's version should reflect only its own changes, not an unrelated internal dependency bump.
- `access: "restricted"` — irrelevant in practice since `changeset publish` is never run, but set to the safe default rather than left implicit.
- `ignore: []` — every workspace participates, including `packages/config-typescript` (its `publishConfig.access: "public"` is pre-existing, unrelated dead config from before this change; it stays `private: true` and unpublished like everything else).
- `privatePackages: { "version": true, "tag": false }` — **load-bearing.** Changesets skips versioning any package with `"private": true` in its `package.json` unless this is set — and every workspace in this repo is `private: true` by design (see Non-goals: nothing here is ever published to npm). Without this key, `changeset version` silently no-ops on the entire repo despite reporting success. `version: true` enables bumping; `tag: false` keeps this consistent with the Non-goal below of not tagging releases yet.

### Root scripts

Added to the root `package.json`:

```json
"changeset": "changeset",
"version-packages": "changeset version"
```

No `release`/`publish` script is added, since publishing is out of scope.

### Workflow

1. On a feature/fix/chore branch, after making a change to one or more workspaces, run `npx changeset`. Pick the affected workspace(s), a bump type for each, write a one-line summary. Commit the generated `.changeset/*.md` file alongside the code change, and include it in the normal PR into `dev`.
2. Periodically — in practice, before a `dev → main` release PR — run `npx changeset version` (or `npm run version-packages`) on `dev`. This bumps every workspace with pending changesets, updates changelogs, and deletes the consumed changeset files. Commit the result (a "Version Packages" commit) and push directly to `dev`, or via its own small PR — either is fine given there's no CI to gate on yet.
3. `changeset publish` is never run. The version bump itself (visible in each workspace's `package.json` and `CHANGELOG.md`) is the deliverable — it's a record of what shipped in each independently-deployed Worker, not an npm release.

### Documentation

A new `## Versioning` section is added to the root `CLAUDE.md`, placed after the existing `## Branching` section — same reasoning as that section: this is a cross-cutting, monorepo-wide concern that belongs in the root doc rather than any one workspace's `CLAUDE.md`. It documents the workflow above at the same level of detail as the `## Branching` section does for branching.

## Testing / verification

This is tooling + documentation, not application code. Verification is:

1. `npx changeset init` produces `.changeset/config.json` matching the design above, and `npm run changeset` / `npm run version-packages` resolve correctly from the root.
2. A throwaway changeset added for one workspace, followed by `npx changeset version`, correctly bumps only that workspace's `package.json` and generates a `CHANGELOG.md` entry, and does not cascade into any dependent workspace (every internal dependency in this repo is `"*"`, so none should move) — then revert this trial run before committing the real (empty) `.changeset/` scaffold.
3. `CLAUDE.md`'s new `## Versioning` section reads clearly and matches this spec.
