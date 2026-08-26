# Auth Worker Design

## Context

`virtual-classroom` is an early-stage Turborepo monorepo with two independently deployable Cloudflare Workers (`worker-client`, `worker-realtime`) and two shared packages. There is currently no authentication or authorization anywhere in the repo — no session/user storage, no OAuth integration, and the two existing workers don't talk to each other or to any third component.

The goal is a new, separately deployed Worker that becomes the single source of truth for user identity, credentials, and (eventually) roles — usable by `worker-client`, `worker-realtime`, and any future application, without those applications needing their own user databases or sign-in logic.

This repo already has Better Auth-focused skills staged (`better-auth-best-practices`, `create-auth`, `organization-best-practices`, `better-auth-security-best-practices`, `two-factor-authentication-best-practices`, `email-and-password-best-practices`), indicating Better Auth is the intended toolkit for auth work in this project.

## Goals

- A new Cloudflare Worker, `apps/worker-auth` (`@capstone/auth`), that owns all user/session/credential data.
- Google sign-in and sign-up working end-to-end, using Better Auth's built-in social provider support.
- The worker acts as its own OAuth2/OIDC **provider** (not just a consumer of Google) via Better Auth's `oidcProvider` plugin, so that future applications can "link" to it the same way you'd add "Sign in with Google" — except the provider is this worker. Linked apps redirect users here to sign in and get back a token plus user info, rather than talking to the database directly.
- Extensible to more identity providers later (GitHub, Microsoft, email/password, 2FA, etc.) as pure configuration additions, no architectural change.
- D1 as the datastore, with Drizzle as the schema/query layer (project preference over Better Auth's default Kysely adapter), living entirely inside `apps/worker-auth` — not a shared package, since no other workspace should ever touch this database directly.

## Non-goals (explicitly deferred)

- **Wiring up `worker-client` or `worker-realtime` as consumers.** This spec produces a standalone, working auth worker. Integrating an existing app as the first "linked application" is a separate follow-up spec.
- **Roles/permissions design.** The user table gets one placeholder `role` field (see Data model) so the shape exists, but the actual roles/permissions model (global vs. per-application, admin UI, etc.) is deliberately deferred to a later design pass.
- **Custom domain.** No custom domain is configured for Cloudflare Workers yet. This design targets the worker's `workers.dev` URL. Moving to a custom domain later is a low-risk follow-up (update `baseURL`/`trustedOrigins` env config and the Google Cloud OAuth client's redirect URI).
- **Additional identity providers beyond Google** (email/password, GitHub, 2FA, etc.) — deliberately out of scope for this pass, but the design must not preclude adding them later.
- **A real second linked application.** Proven via a dummy OAuth client registered through Better Auth's own client-registration endpoint (see Testing), not a real second app.

## Architecture

A new Worker, `apps/worker-auth`, structured like the existing `apps/worker-realtime` (single-purpose Worker, no frontend build step):

- **Routing:** Hono, mounting Better Auth's request handler at `/api/auth/*` (Better Auth's standard convention). Hono is used only as the thin routing layer around Better Auth's handler — no other framework machinery needed.
- **Auth engine:** Better Auth, configured with:
  - `socialProviders.google` — the only configured identity provider today.
  - The `oidcProvider` plugin — makes this worker itself an OAuth2/OIDC issuer. Future applications register as OAuth clients (via Better Auth's client-registration flow) and redirect users to this worker's `/api/auth/oauth2/authorize` endpoint to sign in, receiving back an authorization code they exchange for tokens/user info — the same shape as any third-party "Sign in with X" integration, except this worker is the X.
- **Database:** Cloudflare D1, bound as `AUTH_DB`. Schema and queries via Drizzle (`drizzle-orm/d1`), using Better Auth's `drizzleAdapter`. Schema lives at `apps/worker-auth/src/db/schema.ts`, generated once via `npx @better-auth/cli generate` against the Better Auth config (core tables + `oidcProvider` plugin tables) and owned/hand-edited from there — same pattern as `worker-realtime` owning its own DO storage.
- **Sessions:** Better Auth's default DB-backed session with a secure, httpOnly cookie. No custom session/token logic.
- **Secrets:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (from a Google Cloud OAuth client the user creates manually — outside repo scope), and `BETTER_AUTH_SECRET` (session/token signing). Set via `wrangler secret put` in each environment; local dev values in `.dev.vars` (gitignored, matching standard Workers convention).
- **No verification UI.** No page is served for manual sign-in testing — verification is done by hitting `/api/auth/*` endpoints directly (curl, and a real browser only where Google's own consent screen requires it — see Testing).

## Data model

All tables live in the single `AUTH_DB` D1 database, owned exclusively by this worker:

- **Better Auth core tables:** `user`, `session`, `account` (one row per linked identity provider per user — starts with just Google), `verification`.
- **`user.role`** — a single `text` column, default `'user'`. Placeholder only; no enforcement or admin UI yet. Deferred per Non-goals.
- **`oidcProvider` plugin tables:** registered OAuth client applications, issued access/refresh tokens, and consent records — these are what make "linking a new application" concrete: a new app becomes a row in the client-applications table with a `client_id`/`client_secret`/redirect URI, not a code change in this worker.

## CORS / trusted origins

Better Auth requires a `baseURL` (this worker's own `workers.dev` URL) and a `trustedOrigins` list, used to validate redirect URIs on the OAuth authorization endpoint. Today `trustedOrigins` contains only the worker's own origin plus `localhost` (for local dev) — there are no linked apps yet. Each future linked application adds its own redirect URI when it registers as an OAuth client via the `oidcProvider` plugin's client-registration flow; `trustedOrigins` is not meant to be hand-edited per app going forward.

## Migrations & deployment

- `drizzle-kit` generates SQL migrations from `schema.ts`.
- Applied via `wrangler d1 migrations apply AUTH_DB` (both local and remote), the same migration-tag pattern `worker-realtime` already uses for its Durable Object class.
- `wrangler types` (the repo's standard `typegen` script) regenerates `worker-configuration.d.ts` for the new bindings (`AUTH_DB`, secrets).
- `apps/worker-auth` follows the existing workspace conventions: its own `wrangler.jsonc`, `tsconfig.json` extending `@capstone/typescript`'s shared base (per `packages/config-typescript/CLAUDE.md`), and a `CLAUDE.md` documenting its layout — consistent with `worker-client` and `worker-realtime`.

## Testing / verification

No test runner is configured in this repo yet, so verification is manual:

1. `wrangler d1 migrations apply AUTH_DB` (local) succeeds; `wrangler dev` boots without error.
2. **Google sign-up:** in a real browser (required — Google's consent screen can't be curled), follow `/api/auth/sign-in/social?provider=google`, complete consent, land on the callback. Confirm a new `user` row and `session` row exist in local D1, and a session cookie is set.
3. **Google sign-in (existing user):** repeat step 2 with the same Google account. Confirm the same `user` row is reused (no duplicate) and a new `session` row is created.
4. `GET /api/auth/get-session` with the session cookie returns the signed-in user, including the placeholder `role` field.
5. Sign-out clears the session (subsequent `get-session` call returns unauthenticated).
6. **OIDC provider end-to-end:** register one dummy OAuth client via Better Auth's client-registration endpoint, then drive the full authorization-code flow with curl: `/api/auth/oauth2/authorize` → consent → authorization code → `/api/auth/oauth2/token` exchange → resulting access token resolves to the correct user (e.g. via a userinfo-equivalent endpoint). This proves the "link a new application" capability actually works end-to-end, not just that the plugin is configured.

## Explicitly deferred (revisit later, not now)

- Roles/permissions model (global vs. per-application), and any admin UI for managing users, roles, or registered OAuth client applications.
- Wiring `worker-client` / `worker-realtime` up as consumers of this auth worker.
- Additional identity providers (email/password, GitHub, Microsoft, 2FA).
- Custom domain migration.
