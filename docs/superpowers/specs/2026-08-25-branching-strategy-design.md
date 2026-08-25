# Branching Strategy Design

## Context

This is an early-stage Turborepo monorepo (`virtual-classroom`) with two independently deployable Cloudflare Workers (`worker-client`, `worker-realtime`) and two shared packages. Currently solo-maintained, with the expectation that collaborators may join later to add features and bug fixes. There is no CI pipeline yet (no `.github/workflows`), and deploys are manual via `wrangler`.

The repo already has an informal `main` / `dev` / feature-branch pattern in git history (e.g. the `messenger` branch), but it isn't documented anywhere. This design formalizes it.

## Goals

- Give `dev` a clear role as the default integration branch, and `main` a clear role as the production-ready branch.
- Establish a simple, low-ceremony branch naming convention.
- Define the merge flow (feature → dev → main) so it's obvious to follow solo and easy to onboarding a future collaborator into.
- Define the one exception path (hotfixes to `main`) so it isn't improvised under pressure.
- Stay lightweight: no CI, no branch protection rules, no release tooling — just a documented convention. Those can be layered on later once there's a reason to (e.g. a real collaborator, or a CI pipeline).

## Non-goals

- GitHub branch protection rules / required status checks (no CI exists yet to gate on).
- Per-app release/versioning strategy for the two independently deployed Workers (out of scope for this pass; can be revisited once deploys are automated).
- A ticket/issue-tracking-based naming scheme (no ticket system in use).

## Design

### Branch structure

- **`main`** — production-ready. Deployable at any time. Nothing is pushed directly; it only receives merges via PR, either from `dev` or from a hotfix branch (see below).
- **`dev`** — the default branch. Integration point for all in-progress work. This is what you branch off of for day-to-day work.
- **`feature/*`, `fix/*`, `chore/*`** — short-lived branches cut from `dev`, merged back into `dev` via PR.

### Naming convention

kebab-case, prefixed by intent:

- `feature/<short-desc>` — new functionality, e.g. `feature/screen-share`
- `fix/<short-desc>` — bug fixes, e.g. `fix/socket-reconnect`
- `chore/<short-desc>` — tooling, dependency bumps, docs, e.g. `chore/upgrade-wrangler`

No ticket-ID prefix — there's no issue tracker in use yet. If one gets adopted later, this convention can add a ticket ID segment then.

### Workflow

1. Branch off `dev`: `git checkout -b feature/x dev`
2. Do the work, commit, push.
3. Open a PR `feature/x → dev`. Squash-merge — keeps `dev`'s history to one commit per feature, which stays readable as the repo grows and collaborators join.
4. When `dev` has accumulated a batch of production-ready work, open a PR `dev → main`. Use a regular merge (not squash) here, so `main`'s history preserves the individual feature commits that made up the release.

### Hotfix exception

`main` normally only receives merges from `dev`, but urgent production bugs can't always wait for `dev` to be release-ready. For those:

1. Branch `fix/<short-desc>` off `main` (not `dev`).
2. PR it into `main` and merge.
3. Immediately merge `main` back into `dev` so `dev` doesn't drift out of sync with the hotfix.

### Documentation

Add a `## Branching` section to the root `CLAUDE.md`, appended after its last existing section (`CLAUDE.md` has no `## Commit` section at time of writing) — `CLAUDE.md` already serves as the cross-cutting/monorepo-map document, and this is exactly that kind of concern.

## Explicitly deferred (revisit later, not now)

- CI-backed branch protection (require PR + passing checks before merge).
- Per-Worker release tagging/versioning now that `worker-client` and `worker-realtime` deploy independently.
- Squash-vs-merge policy can be revisited once there are multiple contributors and the current defaults stop fitting.

## Testing / verification

This is a documentation/process change, not code — verification is just confirming the `CLAUDE.md` section reads clearly and matches this spec.
