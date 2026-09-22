# CLAUDE.md — worker-oidc

`@capstone/openid-connect` — email/password sign-in backed by D1 via Drizzle, plus Better Auth's `oauthProvider` plugin (from `@better-auth/oauth-provider`) so this worker serves a real OIDC provider (`/.well-known/openid-configuration`, `/api/auth/oauth2/{authorize,token,userinfo,introspect,revoke,end-session}`, `/api/auth/jwks`). `apps/worker-admin` is registered as a public, PKCE-required, native-app OAuth client (via the bootstrap route below) and drives the full Authorization Code + PKCE flow against this worker — see `apps/worker-admin/CLAUDE.md` for the client side.

This worker follows `apps/worker-client`'s split: a real backend Cloudflare Worker under `worker/` (handling only `/api/auth/*` and `/internal/*`) plus a Vite + React + TanStack Router SPA under `src/` for everything else, built as static assets. There is no more `src/pages.ts` — the old hand-written HTML+JS `/login`/`/consent` pages have been replaced by real React route components (`src/routes/login.tsx`, `consent.tsx`).

**There is no sign-up.** No self-service account creation exists anywhere in this worker or in `apps/worker-admin` — no `/signup` route, no reachable `/sign-up/email` endpoint, and Google sign-in can't create a new account either (see `worker/auth.ts`'s `disabledPaths` and `socialProviders.google.disableSignUp` below). Accounts are seeded one at a time via `worker/bootstrap-admin-user.ts`. Invite-link-based onboarding through `apps/worker-admin` is the intended longer-term replacement but doesn't exist yet.

## Routing split

`wrangler.jsonc`'s `assets` block is what makes this work:

```jsonc
"assets": {
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/auth/*", "/internal/*"]
}
```

`run_worker_first` sends only `/api/auth/*` and `/internal/*` to the Worker (`worker/index.ts`); every other request — including `/login`, `/consent`, and any path that doesn't match a built asset — is served from the built SPA in `dist/`, with `not_found_handling: single-page-application` falling back to `index.html` (the SPA shell) for unmatched paths so the client-side router can take over. There's no server-side route matching for the two page paths anymore — they exist only as TanStack Router file routes on the client.

## Layout

### `worker/` — the backend Worker

- `worker/index.ts` — Hono app. Registers the bootstrap route (`registerBootstrapRoute`, see below), opens CORS on three endpoints called directly cross-origin from `worker-admin`'s browser JS (`/api/auth/jwks`, `/api/auth/oauth2/userinfo`, `/api/auth/oauth2/token` — none of them cookie-gated, same reasoning `worker-auth` applies to its own `/api/auth/jwks`), and mounts Better Auth's handler at `/api/auth/*` unmodified for everything else. No longer serves any HTML pages itself.
- `worker/auth.ts` — `createAuth(db, env)`, the Better Auth factory: Drizzle/D1 adapter, `emailAndPassword` enabled, a Google `socialProviders` entry (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`), `jwt()` + `oauthProvider({ loginPage: '/login', consentPage: '/consent', allowPublicClientPrelogin: true })` plugins. `jwt()` is a hard dependency of `oauthProvider` (it signs OIDC `id_token`s; omitting it throws `BetterAuthError("jwt_config")` at request time), not an optional pairing. `loginPage`/`consentPage` point at the SPA routes described below (asset-served, not Worker routes) — there's no `signup` option anymore; `prompt=create` (unused by any current client) falls back to `loginPage`. `allowPublicClientPrelogin: true` is a hard prerequisite for `src/routes/{login,consent}.tsx`'s client-name lookups (`POST /api/auth/oauth2/public-client-prelogin`) to work at all — without it the endpoint unconditionally 400s and the pages silently fall back to showing the raw `client_id`. `trustedOrigins` includes `env.BETTER_AUTH_URL` (redundant — Better Auth already auto-trusts its own configured `baseURL` origin) and, notably, `'https://example.com'`, needed so the test suite's synthetic cross-origin requests (the `/oauth2/consent` POST in particular, which carries both a session cookie and an `Origin` header) pass `originCheckMiddleware`. Built as a factory rather than a module-level singleton because the D1 binding only exists inside a request's `env`. No self-service accounts: `disabledPaths: ['/sign-up/email']` 404s that route for any HTTP caller (it only gates the router — see `node_modules/better-auth/dist/api/index.mjs`'s `onRequest` — so `auth.api.signUpEmail`, called internally by `worker/bootstrap-admin-user.ts`, still works; Better Auth's own `emailAndPassword.disableSignUp` flag would block that internal call too, since it's checked inside the endpoint handler itself), and `socialProviders.google.disableSignUp: true` stops a first-time Google sign-in from creating a user (it redirects back with `?error=signup_disabled` instead — see `src/GoogleButton.tsx`).
- `worker/register-worker-admin-client.ts` — `registerBootstrapRoute(app)`, mounts `POST /internal/oauth-clients/worker-admin`. Gated by a `Bearer <BETTER_AUTH_SECRET>` header (401 otherwise) and a required `redirect_uri` query param (400 otherwise). Idempotent: looks up an existing `oauth_client` row named `worker-admin` first and returns its `client_id` if found; otherwise it synthesizes a throwaway session directly on the shared `AuthContext` (there's no real signed-in user in this bootstrap flow, but the plugin's `adminCreateOAuthClient` unconditionally requires a session) against a fixed upserted "bootstrap" user row, then calls `adminCreateOAuthClient` to create a public client (`token_endpoint_auth_method: 'none'`, `application_type: 'native'` — required so loopback `http://localhost:...` redirect URIs validate, `skip_consent: false`, `grant_types: ['authorization_code']`). A concurrent duplicate insert (caught via `oauthClient.name`'s unique index) is treated as a race loss, not an error — the loser re-reads and returns the winner's `client_id`. Called once per environment via a manual curl (see below), never by a client itself.
- `worker/bootstrap-admin-user.ts` — `registerBootstrapAdminUserRoute(app)`, mounts `POST /internal/users/bootstrap-admin`, the only way left to create an account. Gated the same way as the client bootstrap route above (`Bearer <BETTER_AUTH_SECRET>`, 401 otherwise; 400 if `email`/`password` are missing from the JSON body). Calls `auth.api.signUpEmail` directly (not the HTTP `/sign-up/email` route), so `disabledPaths` above never sees it. Idempotent: a duplicate email throws Better Auth's `UNPROCESSABLE_ENTITY`/`USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`, which is caught and turned into a 200 no-op, mirroring `register-worker-admin-client.ts`'s idempotency shape. `name` defaults to `'Admin'` if omitted. Run it once per environment:

    ```bash
    curl -X POST "http://localhost:8791/internal/users/bootstrap-admin" \
        -H "Authorization: Bearer <this worker's BETTER_AUTH_SECRET>" \
        -H "Content-Type: application/json" \
        -d '{"email":"<admin email>","password":"<admin password>","name":"Admin"}'
    ```
- `worker/db/client.ts` — `createDb(d1)`, wraps the `OIDC_DB` binding in a Drizzle client.
- `worker/db/schema.ts` — **generated** by `npx auth@latest generate` (see `auth.cli.ts` below), then owned/hand-edited from there. Don't hand-author from scratch; regenerate after adding/changing plugins.
- `auth.cli.ts` (repo root of this workspace) — Node-only shim used solely by the Better Auth CLI to generate `worker/db/schema.ts` (the CLI can't see a real D1 binding). Never imported by the Worker itself.
- `drizzle.config.ts` / `drizzle/*.sql` — `drizzle-kit`-generated migrations (schema source `./worker/db/schema.ts`), applied via `wrangler d1 migrations apply OIDC_DB` (uses the `migrations_dir` set in `wrangler.jsonc`).
- `worker-configuration.d.ts` — **generated** by `wrangler types`; don't Read it in full — `grep` for the specific binding/type you need. Note `wrangler types` also picks up keys from a local `.dev.vars` file (not `.dev.vars.example`) to type `BETTER_AUTH_SECRET`/`BETTER_AUTH_URL`/`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` on `Env` — an untyped `env.BETTER_AUTH_*` reference usually means `.dev.vars` is missing locally.

### `src/` — the React SPA

- `src/main.tsx` — entry point; creates the TanStack Router instance from the generated route tree and renders `<RouterProvider>` into `#root`.
- `src/GoogleButton.tsx` — "Continue with Google" button, rendered by `login.tsx`. `POST`s `/api/auth/sign-in/social` with `provider: 'google'`, `callbackURL: '/api/auth/oauth2/authorize?<oauth_query>'`, `errorCallbackURL: '<current page>?<oauth_query>'`, and the signed `oauth_query` itself, then redirects the browser to the returned `url`. Sending `oauth_query` (not just `callbackURL`) lets the oauth-provider plugin track the flow, so `prompt=login`/`max_age` are honored instead of looping back to `/login`. After Google's callback Better Auth sets the session cookie and lands on `authorize`, resuming the flow like the email sign-in does. A failed Google leg (cancelled consent, `account_not_linked`, or `signup_disabled` — no existing user for this Google account, since `socialProviders.google.disableSignUp: true` in `worker/auth.ts` blocks creating one) returns to the same page with `?error=<code>`, which the button shows as a message (`error`/`error_description` are stripped before the query is reused, so they never reach the signed `oauth_query`). The button disables itself while the request is in flight and shows an error if the request fails.
- `src/routes/__root.tsx` — root layout: bare `Outlet` + `TanStackRouterDevtools`.
- `src/routes/index.tsx` — placeholder index route (`worker-oidc — OpenID Connect provider.`).
- `src/routes/login.tsx` — the sign-in page, and the only account-entry page left. On mount, if the URL has a `client_id` query param, it `POST`s `/api/auth/oauth2/public-client-prelogin` (body `{ client_id, oauth_query }`, where `oauth_query` is the raw query string) to look up and display the requesting client's `client_name`. On submit, it `POST`s email/password to `/api/auth/sign-in/email`, then on success redirects the browser to `/api/auth/oauth2/authorize?<oauth_query>` to resume the OAuth flow. No sign-up link — there's nothing to link to.
- `src/routes/consent.tsx` — the consent page. Reads `client_id`/`scope` off the query string, seeds the displayed client name with the raw `client_id` and upgrades it via the same `public-client-prelogin` lookup once it resolves. "Allow"/"Deny" both `POST` `/api/auth/oauth2/consent` (body `{ accept, oauth_query }`) and redirect the browser to the `url` in the JSON response.
- `src/routeTree.gen.ts` — **generated** by the TanStack Router Vite plugin (`autoCodeSplitting: true`) from `src/routes/`. Don't hand-edit; let the dev server regenerate it.

Both pages talk to `/api/auth/*` with same-origin `fetch` (no CORS needed — they're served from the same origin as the Worker) and drive the flow entirely client-side; neither is server-rendered.

## Regenerating the schema after a config change

`auth@latest` can resolve to a version bundling a newer, schema-incompatible `@better-auth/core` than this workspace's pinned `better-auth@^1.7.1` — pin the CLI version to match and review the generated diff (`git diff worker/db/schema.ts`, expecting only additive changes) before running `drizzle-kit generate`.

```bash
npx auth@1.7.1 generate --config ./auth.cli.ts --adapter drizzle --dialect sqlite --output worker/db/schema.ts -y
npx drizzle-kit generate
```

## Commands (run from this directory, or via `npm run <script> -w @capstone/openid-connect` from root)

- `dev` — `vite` (local port `8791`, inspector port `9233` — set in `vite.config.ts`'s `server.port` / `cloudflare({ inspectorPort })`, not `wrangler.jsonc` anymore; worker-client, worker-realtime, worker-auth, and worker-admin use `5173`/`9229`, `8788`/`9231`, `8789`/`9230`, and `8790`/`9232` respectively). There is no separate `start` script.
- `build` — `tsc -b && vite build`
- `preview` — `npm run build && vite preview`
- `deploy` — `npm run build && wrangler deploy`
- `typegen` — `wrangler types` (regenerates `worker-configuration.d.ts`)
- `migrations:auth` — `wrangler d1 migrations apply worker-oidc --local`, applies pending Drizzle migrations to the local D1
- `lint` — `biome check .`
- `test` / `test:run` — Vitest via `@cloudflare/vitest-pool-workers` (`vitest.config.mjs`, mirroring `worker-auth`'s pattern), reading `wrangler.jsonc` for bindings and applying Drizzle migrations to a test D1 instance through a `setupFiles` hook (`test/apply-migrations.ts`, calling `applyD1Migrations` — safe to run more than once). Files under `test/`: `cors.test.ts` (the three cross-origin CORS exceptions in `worker/index.ts`), `google-sign-in.test.ts` (`/api/auth/sign-in/social` returns a Google authorization URL whose `redirect_uri` points back at this worker — the Google round trip itself, and so `disableSignUp`'s effect on it, isn't covered), `register-worker-admin-client.test.ts` (the client-bootstrap route's auth/validation/idempotency), `bootstrap-admin-user.test.ts` (the admin-user-bootstrap route's auth/validation/idempotency, plus a sign-in check with the seeded credentials), and `oauth-client-flow.test.ts` (a full sign-in → consent → token-exchange run against a freshly bootstrapped client and an account seeded via the internal bootstrap route — there's no self-service sign-up to seed through anymore — plus a case proving `/sign-up/email` 404s, the `public-client-prelogin` lookup, and a signed-`oauth_query` `sign-in/social` check that accepts a valid query and rejects a tampered one, using the same PKCE-pair helper `apps/worker-auth/test/oauth-provider.test.ts` uses). `test/helpers/call-app.ts` (`callAsApp`) wraps `worker/index.ts`'s Hono `app.fetch` with a Miniflare execution context and lets a call override `env` per-request (e.g. a fixed `BETTER_AUTH_SECRET` for the bootstrap-route tests).

**Known gaps:** there are no automated tests for the two React page components (`src/routes/login.tsx`, `consent.tsx`) — same precedent as `apps/worker-admin/CLAUDE.md` notes for its own `login.tsx`/`auth-callback.tsx`. They're exercised only by the manual dev-server smoke check below and, ultimately, by a real browser click-through, which hasn't happened yet for this rewrite. Relatedly, `socialProviders.google.disableSignUp` has no automated coverage either, for the same reason `google-sign-in.test.ts` doesn't cover the callback leg — it needs a real (or mocked) round trip through Google's token/userinfo endpoints, which this test suite doesn't set up.

`.dev.vars.example` lists the required local vars (`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`); copy it to `.dev.vars` (gitignored) and fill in a real secret before running `dev`. Run `npm run migrations:auth` before first use. Deployed, the Google pair is set with `wrangler secret put`.

Google sign-in needs a Google Cloud OAuth client whose authorized redirect URI is `<BETTER_AUTH_URL>/api/auth/callback/google` (`http://localhost:8791/api/auth/callback/google` locally) — sign-in fails with `redirect_uri_mismatch` otherwise. With the vars unset the button shows an error on click. Account linking is deliberately left at Better Auth's defaults, which require the *local* account's email to be verified before a Google sign-in can link to it. This worker never verifies emails, so a Google sign-in whose email matches an existing password user fails with `account_not_linked` and the button tells them to use their password. Don't just set `requireLocalEmailVerified: false` to "fix" it: an attacker could pre-register a victim's email with a password, and the victim's later Google sign-in would then link into the attacker's account (whose password stays valid). Enabling email verification is the proper way to allow linking. A real round trip through Google's consent screen is a manual check only.

## TypeScript config

`tsconfig.json` is a references-only shell pointing at, matching `apps/worker-client/CLAUDE.md`'s description of its own:
- `tsconfig.app.json` — browser/React code under `src/`
- `tsconfig.node.json` — Vite config (`vite.config.ts`)
- `tsconfig.worker.json` — the backend Worker under `worker/` (plus `auth.cli.ts` and `drizzle.config.ts`); types against `worker-configuration.d.ts`

All three extend the shared bases in `@capstone/typescript/configs/` (see `packages/config-typescript/CLAUDE.md`), adding only `tsBuildInfoFile`/`include`/`types` locally.

Biome (repo root config) handles formatting and linting, including React-specific rules (hooks, refresh) via the `react` linter domain — there is no separate ESLint config.

## Connecting a client

`apps/worker-admin` is the one real client today, connected via the bootstrap route (`worker/register-worker-admin-client.ts`) plus the Authorization Code + PKCE flow it drives — see `apps/worker-admin/CLAUDE.md` for the full step-by-step. In short: bootstrap it once per environment with

```bash
curl -X POST "http://localhost:8791/internal/oauth-clients/worker-admin?redirect_uri=http://localhost:8790/auth-callback" \
    -H "Authorization: Bearer <this worker's BETTER_AUTH_SECRET>"
```

which returns `{"client_id": "..."}` (idempotent — re-running it just returns the existing client's id). From there, `worker-admin` redirects to this worker's `/api/auth/oauth2/authorize`, the visitor authenticates against the `/login` SPA route above (accounts are seeded ahead of time via `worker/bootstrap-admin-user.ts` — there's no sign-up page to fall back to) and grants consent on `/consent`, and `worker-admin` exchanges the resulting authorization code for tokens at `/api/auth/oauth2/token`. Registering a second client (a different Worker, or a non-loopback deployment) means calling the same bootstrap route with that client's own `redirect_uri` — the route only ever registers a client named `worker-admin`, so a genuinely different client would need either a parameterized variant of this route or a one-off equivalent call through `auth.api.adminCreateOAuthClient` directly.
