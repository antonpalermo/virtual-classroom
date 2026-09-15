# Central Identity Provider: Hosted Login + JWT Sessions

## Context

`worker-auth` currently has no login UI of its own — the only "Sign in with Google" page lives in `worker-client` (`src/routes/login.tsx`), and `worker-admin` borrows it: `worker-admin`'s `/login` route just links out to `worker-client`'s `/login?returnTo=<worker-admin-origin>/auth-callback` (`docs/superpowers/specs/2026-09-14-admin-user-roles-dashboard-design.md`). After Google's callback, `worker-client`'s passthrough Worker rewrites the redirect's `Location` header to smuggle a Better Auth bearer session token onto a URL fragment, which `worker-admin` then picks up. It works, but it means one app's identity depends on visiting another app's page, with the return-address allowlist duplicated in two places (`apps/worker-client/src/routes/login.tsx` and `apps/worker-client/worker/index.ts`) — this is the "bad UX" this spec exists to fix.

The longer-term goal is for `worker-auth` to become a real Central Identity Provider: it owns registration, login, password reset, and MFA; every other app (`worker-client`, `worker-admin`, eventually `worker-realtime`) just validates a credential worker-auth issued and makes its own permission decisions. That's too large for one change, so it's split into a roadmap:

1. **Hosted login + JWT sessions** (this spec) — `worker-auth` hosts its own login page; every app redirects there directly and gets back a signed JWT it can verify on its own.
2. Admin identity/status management — formalize `worker-admin`'s existing ban/role/status feature set.
3. Email/password login + password reset.
4. MFA.

This spec covers only #1. No password/email auth, MFA, or 2FA exists anywhere in the repo today (confirmed by grep across `apps/worker-auth`) — those remain fully out of scope here.

## Goals

- `worker-auth` serves its own `/login` page. Both `worker-client` and `worker-admin` send a signed-out user there directly (`?returnTo=<their own origin>/auth-callback`); neither one links to the other's UI anymore.
- A single, centralized `returnTo` allowlist lives in `worker-auth`, replacing the two duplicated copies currently in `worker-client`.
- On successful sign-in, `worker-auth` redirects back to `returnTo` carrying a signed JWT (via the already-configured but currently unused `jwt()` plugin), extended to include the user's `role` claim.
- `worker-client` and `worker-admin` verify that JWT locally (signature + expiry, via `worker-auth`'s public JWKS endpoint) to know who's signed in and what role they hold, without a network round-trip on every check.
- `worker-client` gains its own `/auth-callback` route (today sign-in redirects it straight back to `/login`, since it's never had to receive a token from elsewhere).

## Non-goals (explicitly deferred)

- **Unifying the JWT with `worker-auth`'s admin-plugin authorization.** `worker-auth`'s `/api/auth/admin/*` endpoints (used by `worker-admin`'s dashboard for `setRole`/`ban`/`unban`/`removeUser`) only accept a session presented via the `bearer` plugin's own opaque token format — not the new JWT (an earlier draft of the `2026-09-14` spec tried unifying these via the `oauthProvider` plugin and abandoned it over exactly this format mismatch). This spec does not change that: `worker-auth`'s login-complete redirect carries **both** the new JWT and the existing opaque bearer token, and `worker-admin` keeps using the bearer token for admin-plugin calls, unchanged. Reconciling the two credentials (e.g. moving the bearer token server-side so the browser never sees it) is left to the "admin identity/status management" chunk.
- **Email/password, password reset, MFA.** Chunks 3 and 4 on the roadmap above.
- **`worker-realtime`.** Not wired to `AUTH_SERVICE` at all yet; out of scope.
- **Refresh tokens / long-lived sessions.** The JWT is short-lived; expiry just means signing in again, same as today's bearer token in `sessionStorage`.
- **A custom domain / shared-cookie session model.** Sessions still cross origins via a token on a URL fragment, not a shared cookie — no change to that constraint in this pass.

## Architecture

### Hosted login (`worker-auth`)

`worker-auth` gains a `GET /login` route, outside the `/api/auth/*` Better Auth mount (added to `src/index.ts`, or a small new `src/hosted-login.ts` module it wires in). It's a plain server-rendered HTML page — no new frontend build step, since it's one button — that:

- Reads `?returnTo=`, checks it against a new `ALLOWED_RETURN_ORIGINS` list (env-driven, this worker's own config — replacing the two duplicated arrays currently in `worker-client`). An unrecognized `returnTo` gets a 400 here, rather than being accepted and gated later by the redirecting app.
- Triggers Google sign-in with `callbackURL` pointing at a same-origin completion step (e.g. `/login/complete?returnTo=<value>`) rather than back to `/login` itself.
- On `/login/complete`, after Better Auth's Google callback has established the session: re-validates `returnTo` against the same allowlist, mints a JWT for the session via the `jwt()` plugin, and 302s to `${returnTo}#token=<jwt>&session=<bearer token>` — the bearer token is captured the same way `worker-client`'s passthrough does today (`set-auth-token` response header), just one hop earlier, directly at the source.

Two config changes fall out of this:

- **`BETTER_AUTH_URL` moves from `worker-client`'s origin to `worker-auth`'s own.** Better Auth derives both the Google `redirect_uri` and the session cookie's scope from `baseURL` — since `worker-auth` now hosts the login page and owns the callback, it needs to own that URL too. This has one real infra consequence: Google Cloud Console's OAuth client needs its authorized redirect URI updated from `<worker-client-origin>/api/auth/callback/google` to `<worker-auth-origin>/api/auth/callback/google`, for both local dev and the deployed app — a manual step to do alongside this change, not something the code migrates automatically.
- **`trustedOrigins`** gains `worker-client`'s and `worker-admin`'s origins (both apps' browsers now call `worker-auth`'s `/login` directly, cross-origin, instead of proxying everything through a service binding).
- **`jwt()`'s payload** is extended (its `definePayload` option) to include `role`, so consumers get it from the token without an extra call.

### `worker-client`

- `src/routes/login.tsx` stops performing Google sign-in itself. It becomes a redirect, same shape as `worker-admin`'s existing `login.tsx`: `window.location.href = "<worker-auth-origin>/login?returnTo=" + encodeURIComponent(window.location.origin + "/auth-callback")`.
- Gains a new `src/routes/auth-callback.tsx` (doesn't exist today — sign-in has always redirected straight back to `/login` itself). Reads `#token=`/`session=` off the fragment, stores them, navigates to `/`. Same shape as `worker-admin`'s existing `auth-callback.tsx`.
- `worker/index.ts`'s passthrough loses the `set-auth-token`-rewrite branch and its `ALLOWED_RETURN_ORIGINS` copy entirely — `worker-auth` now mints and redirects the token itself, one hop earlier. The passthrough goes back to bare forwarding (`/api/auth/*` → `AUTH_SERVICE`, 404 otherwise), the same shape as `worker-admin`'s.
- `src/lib/auth-client.ts` (used by the home page to show "signed in as X") switches from asking Better Auth for the current session to reading the stored JWT and verifying it locally, since the session cookie no longer lives on this origin.

### `worker-admin`

- `src/routes/login.tsx` redirects straight to `worker-auth`'s `/login?returnTo=<this origin>/auth-callback` — drops the intermediate hop through `worker-client` entirely; no more hardcoded `CLIENT_ORIGIN`.
- `src/routes/auth-callback.tsx` is unchanged in shape (it already reads a token off `#token=`), extended to also capture `session=` (the bearer token) alongside the JWT.
- `src/lib/auth-client.ts` keeps sending the bearer token as `Authorization: Bearer <token>` for admin-plugin calls (`setRole`/`ban`/`unban`/`removeUser`) — unchanged, per the admin-plugin non-goal above. The dashboard's `beforeLoad` auth guard (`src/routes/index.tsx`) switches from resolving the session via `authClient.useSession()` to decoding the stored JWT locally for its role check — still UX-only gating, same as today; the real enforcement stays server-side in `worker-auth`.

### Shared JWT verification

Both `worker-client` and `worker-admin` need the identical "verify this JWT against worker-auth's JWKS, return its claims" logic — this is browser-side code (used by each SPA to decide what to render), so it can't rely on a service binding; it fetches `worker-auth`'s public `/api/auth/jwks` endpoint over plain HTTPS, same as any JWKS consumer. That logic is real, duplicated-if-not-shared logic, so it gets a small new workspace, `packages/auth-verify` (`@capstone/auth-verify`), following the existing `packages/web-standards` pattern: one file, one `verifyAccessToken(jwt, jwksUrl)` function (using `jose`, already a `better-auth` dependency), returning the decoded `{ sub, email, role, exp }` or `null` on any verification failure (bad signature, expired, malformed). No caching layer beyond `jose`'s own remote-JWKS-set caching.

Fetching the JWKS this way means `worker-client`'s and `worker-admin`'s browser JS calls `worker-auth`'s `/api/auth/jwks` cross-origin — that route needs a permissive CORS policy (`Access-Control-Allow-Origin: *` is fine; it's a set of public keys, nothing sensitive) added in `worker-auth`. Confirm during implementation whether Better Auth already sets this on its own routes or whether it needs adding explicitly.

## Data model

No schema change. The `jwt()` plugin's `jwks` table already exists (generated, currently unused); this activates it, it doesn't add to it. `definePayload` is an application-level config, not a schema change.

## Testing / verification

- **`packages/auth-verify`:** unit tests for `verifyAccessToken` — valid token, expired token, bad signature, malformed token, token missing the `role` claim.
- **`worker-auth`:** route tests for `/login` and `/login/complete` — an unrecognized `returnTo` is rejected before any redirect happens; a valid `returnTo` plus a mocked successful Google callback (same mock helper the existing suite already uses) produces a redirect carrying both `#token=` and `session=`, and the JWT's decoded payload includes `role`.
- **`worker-client`:** the passthrough rewrite test added in the `2026-09-14` spec is deleted along with the logic it covered — the passthrough returns to the same bare-forwarding shape `worker-admin`'s already has (untested, by precedent).
- **Manual browser check:** the full round trip for both apps against local dev servers for all three workers — `worker-client`'s own sign-in (now bouncing out to `worker-auth` and back) and `worker-admin`'s sign-in (now going straight to `worker-auth`, no hop through `worker-client`) — plus one check of the "unrecognized `returnTo`" rejection. No frontend component test runner exists in this repo (established non-goal from the prior admin spec); the `/login`/`auth-callback` routes' own rendering is covered by this manual check, not automated tests.

## Versioning

Run `npm run changeset` and select `@capstone/auth` (hosted login, JWT payload, `BETTER_AUTH_URL`/`trustedOrigins` change), `@capstone/client` (login/auth-callback rewrite, passthrough simplification), `@capstone/admin` (login redirect target, auth-callback change), and the new `@capstone/auth-verify` package together in the same run.
