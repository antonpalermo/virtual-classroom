# Auth Worker Design

## Context

`virtual-classroom` is an early-stage Turborepo monorepo with two independently deployable Cloudflare Workers (`worker-client`, `worker-realtime`) and two shared packages. There is currently no authentication or authorization anywhere in the repo — no session/user storage, no OAuth integration, and the two existing workers don't talk to each other or to any third component.

The goal is a new, separately deployed Worker that becomes the single source of truth for user identity, credentials, and (eventually) roles — usable by `worker-client`, `worker-realtime`, and any future application, without those applications needing their own user databases or sign-in logic.

This repo already has Better Auth-focused skills staged (`better-auth-best-practices`, `create-auth`, `organization-best-practices`, `better-auth-security-best-practices`, `two-factor-authentication-best-practices`, `email-and-password-best-practices`), indicating Better Auth is the intended toolkit for auth work in this project.

## Goals

- A new Cloudflare Worker, `apps/worker-auth` (`@capstone/auth`), that owns all user/session/credential data.
- Google sign-in and sign-up working end-to-end, using Better Auth's built-in social provider support.
- The worker acts as its own OAuth 2.1 **provider** (not just a consumer of Google) via Better Auth's `oauthProvider` plugin (package `@better-auth/oauth-provider`, used together with the `jwt` plugin it depends on), so that future applications can "link" to it the same way you'd add "Sign in with Google" — except the provider is this worker. Linked apps redirect users here to sign in and get back a token plus user info, rather than talking to the database directly.
- Extensible to more identity providers later (GitHub, Microsoft, email/password, 2FA, etc.) as pure configuration additions, no architectural change.
- D1 as the datastore, with Drizzle as the schema/query layer (project preference over Better Auth's default Kysely adapter), living entirely inside `apps/worker-auth` — not a shared package, since no other workspace should ever touch this database directly.

## Non-goals (explicitly deferred)

- **Wiring up `worker-client` or `worker-realtime` as consumers.** This spec produces a standalone, working auth worker. Integrating an existing app as the first "linked application" is a separate follow-up spec.
- **Roles/permissions design.** The user table gets one placeholder `role` field (see Data model) so the shape exists, but the actual roles/permissions model (global vs. per-application, admin UI, etc.) is deliberately deferred to a later design pass. No admin UI for managing users, roles, or registered OAuth client applications either.
- **Custom domain.** No custom domain is configured for Cloudflare Workers yet. This design targets the worker's `workers.dev` URL. Moving to a custom domain later is a low-risk follow-up (update `baseURL`/`trustedOrigins` env config and the Google Cloud OAuth client's redirect URI).
- **Additional identity providers beyond Google** (email/password, GitHub, Microsoft, 2FA, etc.) — deliberately out of scope for this pass, but the design must not preclude adding them later.
- **A real second linked application.** Proven via a dummy OAuth client registered through Better Auth's own client-registration flow (see Testing), not a real second app.

## Architecture

A new Worker, `apps/worker-auth`, structured like the existing `apps/worker-realtime` (single-purpose Worker, no frontend build step):

- **Routing:** Hono, mounting Better Auth's request handler at `/api/auth/*` (Better Auth's standard convention). Hono is used only as the thin routing layer around Better Auth's handler — no other framework machinery needed.
- **Auth engine:** Better Auth, configured with:
  - `socialProviders.google` — the only configured identity provider today.
  - The `oauthProvider` plugin (`@better-auth/oauth-provider`, requires `jwt` from `better-auth/plugins` alongside it) — makes this worker itself an OAuth 2.1 issuer. Future applications register as OAuth clients — via `auth.api.createOAuthClient` (authenticated, called with a signed-in user's session headers) or, once enabled, dynamic client registration at `/oauth2/register` — and redirect users to this worker's authorize endpoint to sign in, receiving back an authorization code they exchange for tokens/user info. Routes live under Better Auth's basePath (default `/api/auth`), e.g. `/api/auth/oauth2/authorize`, `/api/auth/oauth2/token` — confirm the exact mounted paths against the running worker's `/api/auth/reference` (if the `openAPI` plugin is added) or the plugin's source at implementation time. The plugin exposes `loginPage`/`consentPage` config paths that unauthenticated/non-trusted-client requests get redirected to; since this spec has no UI (see below), those configured paths are placeholders that are never expected to be hit in this pass — every flow this spec exercises uses an already-authenticated session and a client marked `skip_consent: true`.
- **Database:** Cloudflare D1, bound as `AUTH_DB`. Schema and queries via Drizzle (`drizzle-orm/d1`), using Better Auth's `drizzleAdapter(db, { provider: "sqlite" })`. Schema lives at `apps/worker-auth/src/db/schema.ts`, generated via `npx auth@latest generate --adapter drizzle --dialect sqlite --output src/db/schema.ts` against the Better Auth config (core tables + `oauthProvider`/`jwt` plugin tables) and owned/hand-edited from there — same pattern as `worker-realtime` owning its own DO storage.
- **Sessions:** Better Auth's default DB-backed session with a secure, httpOnly cookie. No custom session/token logic.
- **Secrets:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (from a Google Cloud OAuth client the user creates manually — outside repo scope), and `BETTER_AUTH_SECRET` (session/token signing). Set via `wrangler secret put` in each environment; local dev values in `.dev.vars` (gitignored, matching standard Workers convention).
- **Compatibility flag:** `nodejs_compat` must be added to `wrangler.jsonc` — Better Auth relies on `AsyncLocalStorage`, which Workers only expose under this flag.
- **No verification UI.** No page is served for manual sign-in testing — verification is primarily automated (see Testing), with one manual real-browser check against an actual Google account since that leg can't be automated.

## Data model

All tables live in the single `AUTH_DB` D1 database, owned exclusively by this worker:

- **Better Auth core tables:** `user`, `session`, `account` (one row per linked identity provider per user — starts with just Google), `verification`.
- **`user.role`** — a single `text` column, default `'user'`. Placeholder only; no enforcement or admin UI yet. Deferred per Non-goals.
- **`oauthProvider`/`jwt` plugin tables:** registered OAuth client applications, issued access/refresh tokens, and consent records (exact table names are whatever `npx auth@latest generate` produces for these plugins) — these are what make "linking a new application" concrete: a new app becomes a row in the client-applications table with a `client_id`/`client_secret`/redirect URI, not a code change in this worker.

## CORS / trusted origins

Better Auth requires a `baseURL` (this worker's own `workers.dev` URL) and a `trustedOrigins` list, used to validate redirect URIs on the OAuth authorization endpoint. Today `trustedOrigins` contains only the worker's own origin plus `localhost` (for local dev) — there are no linked apps yet. Each future linked application adds its own redirect URI when it registers as an OAuth client via the `oauthProvider` plugin's client-registration flow; `trustedOrigins` is not meant to be hand-edited per app going forward.

## Migrations & deployment

- `drizzle-kit` generates SQL migrations from `schema.ts`.
- Applied via `wrangler d1 migrations apply AUTH_DB` (both local and remote), the same migration-tag pattern `worker-realtime` already uses for its Durable Object class.
- `wrangler types` (the repo's standard `typegen` script) regenerates `worker-configuration.d.ts` for the new bindings (`AUTH_DB`, secrets).
- `apps/worker-auth` follows the existing workspace conventions: its own `wrangler.jsonc`, `tsconfig.json` extending `@capstone/typescript`'s shared base (per `packages/config-typescript/CLAUDE.md`), and a `CLAUDE.md` documenting its layout — consistent with `worker-client` and `worker-realtime`.

## Testing / verification

No test runner is configured in this repo yet — adding one (Vitest with `@cloudflare/vitest-pool-workers`, the same tool the `durable-objects` skill recommends) is part of this work. Verification is TDD throughout: every behavior below is a failing automated test written before the code that makes it pass, run via `SELF.fetch(...)` against the real worker inside the Workers runtime (Miniflare), backed by a real local D1 instance.

The one leg that can't be automated is an actual round trip through Google's own consent screen — that stays a manual, one-time developer check. Everything else, including the Google sign-in/sign-up *callback handling*, is automated by mocking Google's OAuth endpoints (token exchange, userinfo) with `cloudflare:test`'s `fetchMock`, which intercepts outbound `fetch()` calls the worker makes during the test run. This lets the full sign-up/callback/session-creation code path run deterministically in CI without a real Google account.

**Automated (Vitest, TDD):**
1. `GET /api/auth/ok` returns `{ status: "ok" }` — proves the worker boots, D1 migrations applied, and Better Auth is mounted.
2. `GET /api/auth/sign-in/social?provider=google` returns a redirect to Google's authorization endpoint with the expected `client_id`, `redirect_uri`, and `scope` — no real Google call needed for this leg.
3. **Google sign-up:** with `fetchMock` stubbing Google's token and userinfo endpoints to return a fixed fake profile, hitting the callback URL (as Google would after consent) creates a new `user` row, a matching `account` row, a `session` row, and sets a session cookie.
4. **Google sign-in (existing user):** repeating step 3 with the same fake profile reuses the same `user` row (no duplicate) and creates a new `session` row.
5. `GET /api/auth/get-session` with the session cookie returns the signed-in user, including the placeholder `role` field (default `'user'`).
6. Sign-out clears the session (a subsequent `get-session` call returns unauthenticated).
7. **OAuth provider end-to-end:** using the still-authenticated session from step 3/4, call `auth.api.createOAuthClient` (or the admin variant) to register one dummy OAuth client with `skip_consent: true`, then drive the full authorization-code flow via `SELF.fetch`: authorize → authorization code → token exchange → the resulting access token resolves to the correct user. This proves the "link a new application" capability actually works end-to-end, not just that the plugin is configured.

**Manual, one-time (real Google account, real browser):**
8. `wrangler dev` locally, follow `/api/auth/sign-in/social?provider=google` in an actual browser, complete Google's real consent screen, confirm the callback succeeds and a real session is created — a sanity check that the mocked test suite above matches Google's real behavior.
