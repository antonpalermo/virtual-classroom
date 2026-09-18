# worker-admin as a worker-oidc OAuth Client

## Context

`worker-admin` currently signs in exclusively through `worker-auth` (Google, via the `AUTH_SERVICE` service binding and a same-shape hosted-login redirect — see `docs/superpowers/specs/2026-09-15-central-idp-hosted-login-design.md`), and its dashboard's user-management controls (`setRole`/`banUser`/`unbanUser`/`removeUser`) call `worker-auth`'s `admin` plugin directly with a bearer session token.

`worker-oidc` (`@capstone/openid-connect`) was scaffolded separately (`feat(oidc): scaffold worker with Better Auth basics (#31)`) as a real OIDC provider — email/password via `emailAndPassword`, Better Auth's `oauthProvider` plugin — but has no registered clients and no `/login`/`/consent` pages yet (both are just config strings in `src/auth.ts` today).

`worker-auth` is going to be deprecated. This change does **not** attempt to port `worker-auth`'s admin/role machinery onto `worker-oidc` — that's future work, tracked as a non-goal below. This change's scope is narrow and mechanical: make `worker-admin` a real, working OIDC client of `worker-oidc` for sign-in, and shrink `worker-admin`'s dashboard down to what that alone supports.

## Goals

- `worker-oidc` gets real `/login` and `/signup` pages (email/password, via `emailAndPassword`) and a real `/consent` page — `worker-admin` is a registered client with `skip_consent: false`, so a user sees and accepts an explicit consent screen.
- `worker-admin` registers as a public OAuth client (`token_endpoint_auth_method: "none"`) of `worker-oidc`, via a one-off server-side seed script using the plugin's `SERVER_ONLY` `adminCreateOAuthClient` API — not dynamic client registration.
- `worker-admin`'s browser drives the full Authorization Code + PKCE flow itself: redirect to `/oauth2/authorize`, land back on `/auth-callback` with `?code=&state=` on the query string, `fetch`-POST the code exchange to `/oauth2/token` directly (cross-origin, CORS-enabled), store the resulting `id_token` (and `access_token`, unused for now).
- The dashboard verifies the stored `id_token` locally (reusing `@capstone/auth-verify`'s existing `verifyAccessToken`, pointed at `worker-oidc`'s JWKS endpoint) and renders "signed in as `<email>`" plus sign-out.
- `worker-admin` drops its `AUTH_SERVICE` service binding and backend Worker entirely — it becomes a fully static SPA, since nothing it does anymore needs server-side request handling.

## Non-goals (explicitly deferred)

- **Roles, admin-plugin parity, user management.** `worker-oidc` does not get the `admin` plugin, `access-control.ts`, `manager-restrictions.ts`, or an `ADMIN_USER_IDS` bootstrap in this pass, and no OAuth-access-token-to-session bridge is built. `worker-admin`'s dashboard loses its user list / role / ban / remove UI along with this — it comes back in a later spec once `worker-oidc` grows that capability. Explicitly requested by the user: *"just link worker-admin, do not mirror worker-auth since I will be deprecating it soon. We'll handle the roles later."*
- **`role` claim on tokens.** Neither the `id_token` nor any access token carries a `role` this pass.
- **Refresh tokens.** The `offline_access` scope is not requested, so no refresh token is issued; an expired `id_token` just means signing in again, same "re-login on expiry" behavior as today's JWT.
- **Migrating `worker-auth` accounts.** `worker-oidc` has its own D1/user table; existing `worker-auth` users (including any admin accounts) do not carry over. Out of scope here — becomes relevant once the roles work lands.
- **Dynamic client registration.** `worker-admin`'s client is seeded once via the server-only admin API, not registered at runtime.

## Architecture

### Client registration (`worker-oidc`)

A new one-off script, `register-worker-admin-client.ts` (same spirit as the existing `auth.cli.ts` — Node-only, never imported by the Worker itself), calls `createAuth(db, env).api.adminCreateOAuthClient({ body: {...} })` with:

- `client_name: "worker-admin"`
- `redirect_uris: ["<worker-admin origin>/auth-callback"]`
- `token_endpoint_auth_method: "none"` (public client)
- `application_type: "web"`
- `skip_consent: false`
- `grant_types: ["authorization_code"]`, `response_types: ["code"]`

Run once per environment (local + deployed). The response's `client_id` (a public value, no secret is issued to a public client) is recorded in `worker-admin`'s env (`.dev.vars`/`VITE_OIDC_CLIENT_ID`-style) for the SPA to read at build time.

### `worker-oidc`: login, signup, consent pages

Plain server-rendered HTML routes added to `src/index.ts` (no frontend build step, matching `worker-auth`'s existing `/login`):

- `GET /login` — email/password form, posts to Better Auth's `emailAndPassword` sign-in endpoint, then resumes the OAuth flow already in progress (the `oauthProvider` plugin's own continuation mechanics — `loginPage`'s redirect back into `/oauth2/authorize`).
- `GET /signup` — registration form (wired as the `oauthProvider` plugin's `signup.page`), posts to `emailAndPassword` sign-up, then continues into the flow the same way.
- `GET /consent` — reads `client_id`/`scope`/`code` off the query string, renders a plain "worker-admin wants to sign you in" screen, and POSTs `{ accept, code }` to `/oauth2/consent` on accept (or `{ accept: false }` on deny).

CORS is opened on `/api/auth/oauth2/token`, `/api/auth/oauth2/userinfo`, and `/api/auth/jwks` for `worker-admin`'s origin — these are called directly, cross-origin, from `worker-admin`'s browser JS, the same reasoning `worker-auth` already applied to its own `/api/auth/jwks`.

### `worker-admin`: PKCE flow

- **`src/lib/pkce.ts`** (new) — `createPkcePair()`: generates a random `code_verifier`, derives the S256 `code_challenge` via `crypto.subtle.digest`.
- **`src/routes/login.tsx`** — on click: generate the PKCE pair and a random `state`, store both in `sessionStorage`, navigate (`window.location.href`, full top-level navigation — this cannot be a `fetch`) to:
  `<OIDC_ORIGIN>/api/auth/oauth2/authorize?client_id=<id>&redirect_uri=<origin>/auth-callback&response_type=code&scope=openid%20email%20profile&code_challenge=<...>&code_challenge_method=S256&state=<...>`
- **`src/routes/auth-callback.tsx`** — reads `code`/`state` from `window.location.search` (query string, not the fragment — this is a standard authorization-code redirect, unlike today's fragment-based JWT handoff). Rejects if `state` doesn't match the stored value. `fetch`-POSTs to `<OIDC_ORIGIN>/api/auth/oauth2/token` (`grant_type=authorization_code`, `code`, `code_verifier`, `redirect_uri`, `client_id`), stores the response's `id_token` via `storeJwt` (kept from today's helper; `access_token` stored alongside for future use, unused this pass), clears the PKCE/state sessionStorage entries, navigates to `/`.
- **`src/lib/auth-client.ts`** — drops `adminClient()`, the Better Auth `authClient` instance, and `getStoredSession`/`storeSession`/`clearStoredSession` (nothing calls admin-plugin routes anymore). Keeps `storeJwt`/`getStoredJwt`/`clearStoredJwt`.
- **`src/routes/index.tsx`** — `beforeLoad` unchanged in shape (redirect to `/login` if no stored `id_token`). Component verifies the token via `verifyAccessToken` (against `worker-oidc`'s JWKS URL) and renders "signed in as `<email>`" with a sign-out button (clears storage, redirects to `/login`). The role-gated user list and all `authClient.admin.*` calls are deleted.
- **`worker/index.ts` and `wrangler.jsonc`** — the backend Worker file and its one test (`test/index.test.ts`) are deleted; `wrangler.jsonc` drops `main` and the `services` binding, becoming an assets-only static Worker. (Exact assets-only `wrangler.jsonc` shape confirmed against Cloudflare's current docs during implementation.)

### `@capstone/auth-verify`

`AccessTokenClaims.role` becomes optional (`role?: string`), and `verifyAccessToken`'s `requiredClaims` drops `'role'` — `worker-oidc`'s `id_token` doesn't carry one yet. `worker-client` and `worker-auth`'s existing tokens are unaffected (they still carry `role`; nothing required it to be absent).

## Data model

No schema change to either worker's D1 database. `worker-oidc`'s `oauth_client` table (already generated, currently empty) gets one row via the seed script.

## Testing / verification

- **`packages/lib-auth-verify`:** existing unit tests updated for `role` now being optional (a token without `role` still verifies; one with it still returns it).
- **`worker-admin`:** `test/index.test.ts` and its `AUTH_SERVICE` mock in `vitest.config.mjs` are deleted. A new unit test for `src/lib/pkce.ts` (code_verifier/code_challenge shape, S256 derivation). No route-level automated test for `login.tsx`/`auth-callback.tsx` (no frontend component test runner in this repo, established non-goal from prior admin specs).
- **`worker-oidc`:** route tests for `/login`, `/signup`, `/consent`, mirroring the shape of `worker-auth`'s existing hosted-login tests where practical (this worker has no test suite today — this is its first).
- **Manual browser check:** full round trip against local `worker-admin` + `worker-oidc` dev servers — sign up a new account, sign in, see and accept the consent screen, land back on `worker-admin` showing "signed in as `<email>`", sign out.

## Versioning

`npm run changeset`, selecting `@capstone/admin`, `@capstone/openid-connect`, and `@capstone/auth-verify` together in the same run.
