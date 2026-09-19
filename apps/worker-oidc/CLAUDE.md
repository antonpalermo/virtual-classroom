# CLAUDE.md — worker-oidc

`@capstone/openid-connect` — email/password sign-in backed by D1 via Drizzle, plus Better Auth's `oauthProvider` plugin (from `@better-auth/oauth-provider`) so this worker serves a real OIDC provider (`/.well-known/openid-configuration`, `/api/auth/oauth2/{authorize,token,userinfo,introspect,revoke,end-session}`, `/api/auth/jwks`). `apps/worker-admin` is registered as a public, PKCE-required, native-app OAuth client (via the bootstrap route below) and drives the full Authorization Code + PKCE flow against this worker — see `apps/worker-admin/CLAUDE.md` for the client side.

This worker follows `apps/worker-client`'s split: a real backend Cloudflare Worker under `worker/` (handling only `/api/auth/*` and `/internal/*`) plus a Vite + React + TanStack Router SPA under `src/` for everything else, built as static assets. There is no more `src/pages.ts` — the old hand-written HTML+JS `/login`, `/signup`, `/consent` pages have been replaced by real React route components (`src/routes/login.tsx`, `signup.tsx`, `consent.tsx`).

## Routing split

`wrangler.jsonc`'s `assets` block is what makes this work:

```jsonc
"assets": {
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/auth/*", "/internal/*"]
}
```

`run_worker_first` sends only `/api/auth/*` and `/internal/*` to the Worker (`worker/index.ts`); every other request — including `/login`, `/signup`, `/consent`, and any path that doesn't match a built asset — is served from the built SPA in `dist/`, with `not_found_handling: single-page-application` falling back to `index.html` (the SPA shell) for unmatched paths so the client-side router can take over. There's no server-side route matching for the three page paths anymore — they exist only as TanStack Router file routes on the client.

## Layout

### `worker/` — the backend Worker

- `worker/index.ts` — Hono app. Registers the bootstrap route (`registerBootstrapRoute`, see below), opens CORS on three endpoints called directly cross-origin from `worker-admin`'s browser JS (`/api/auth/jwks`, `/api/auth/oauth2/userinfo`, `/api/auth/oauth2/token` — none of them cookie-gated, same reasoning `worker-auth` applies to its own `/api/auth/jwks`), and mounts Better Auth's handler at `/api/auth/*` unmodified for everything else. No longer serves any HTML pages itself.
- `worker/auth.ts` — `createAuth(db, env)`, the Better Auth factory: Drizzle/D1 adapter, `emailAndPassword` enabled, `jwt()` + `oauthProvider({ loginPage: '/login', consentPage: '/consent', signup: { page: '/signup' } })` plugins. `jwt()` is a hard dependency of `oauthProvider` (it signs OIDC `id_token`s; omitting it throws `BetterAuthError("jwt_config")` at request time), not an optional pairing. `loginPage`/`consentPage`/`signup.page` point at the SPA routes described below (asset-served, not Worker routes). `trustedOrigins` includes `env.BETTER_AUTH_URL` (redundant — Better Auth already auto-trusts its own configured `baseURL` origin) and, notably, `'https://example.com'`, needed so the test suite's synthetic cross-origin requests (the `/oauth2/consent` POST in particular, which carries both a session cookie and an `Origin` header) pass `originCheckMiddleware`. Built as a factory rather than a module-level singleton because the D1 binding only exists inside a request's `env`.
- `worker/register-worker-admin-client.ts` — `registerBootstrapRoute(app)`, mounts `POST /internal/oauth-clients/worker-admin`. Gated by a `Bearer <BETTER_AUTH_SECRET>` header (401 otherwise) and a required `redirect_uri` query param (400 otherwise). Idempotent: looks up an existing `oauth_client` row named `worker-admin` first and returns its `client_id` if found; otherwise it synthesizes a throwaway session directly on the shared `AuthContext` (there's no real signed-in user in this bootstrap flow, but the plugin's `adminCreateOAuthClient` unconditionally requires a session) against a fixed upserted "bootstrap" user row, then calls `adminCreateOAuthClient` to create a public client (`token_endpoint_auth_method: 'none'`, `application_type: 'native'` — required so loopback `http://localhost:...` redirect URIs validate, `skip_consent: false`, `grant_types: ['authorization_code']`). A concurrent duplicate insert (caught via `oauthClient.name`'s unique index) is treated as a race loss, not an error — the loser re-reads and returns the winner's `client_id`. Called once per environment via a manual curl (see below), never by a client itself.
- `worker/db/client.ts` — `createDb(d1)`, wraps the `OIDC_DB` binding in a Drizzle client.
- `worker/db/schema.ts` — **generated** by `npx auth@latest generate` (see `auth.cli.ts` below), then owned/hand-edited from there. Don't hand-author from scratch; regenerate after adding/changing plugins.
- `auth.cli.ts` (repo root of this workspace) — Node-only shim used solely by the Better Auth CLI to generate `worker/db/schema.ts` (the CLI can't see a real D1 binding). Never imported by the Worker itself.
- `drizzle.config.ts` / `drizzle/*.sql` — `drizzle-kit`-generated migrations (schema source `./worker/db/schema.ts`), applied via `wrangler d1 migrations apply OIDC_DB` (uses the `migrations_dir` set in `wrangler.jsonc`).
- `worker-configuration.d.ts` — **generated** by `wrangler types`; don't Read it in full — `grep` for the specific binding/type you need. Note `wrangler types` also picks up keys from a local `.dev.vars` file (not `.dev.vars.example`) to type `BETTER_AUTH_SECRET`/`BETTER_AUTH_URL` on `Env` — an untyped `env.BETTER_AUTH_*` reference usually means `.dev.vars` is missing locally.

### `src/` — the React SPA

- `src/main.tsx` — entry point; creates the TanStack Router instance from the generated route tree and renders `<RouterProvider>` into `#root`.
- `src/routes/__root.tsx` — root layout: bare `Outlet` + `TanStackRouterDevtools`.
- `src/routes/index.tsx` — placeholder index route (`worker-oidc — OpenID Connect provider.`).
- `src/routes/login.tsx` — the sign-in page. On mount, if the URL has a `client_id` query param, it `POST`s `/api/auth/oauth2/public-client-prelogin` (body `{ client_id, oauth_query }`, where `oauth_query` is the raw query string) to look up and display the requesting client's `client_name`. On submit, it `POST`s email/password to `/api/auth/sign-in/email`, then on success redirects the browser to `/api/auth/oauth2/authorize?<oauth_query>` to resume the OAuth flow. Links to `/signup?<oauth_query>`.
- `src/routes/signup.tsx` — the sign-up page. Same `public-client-prelogin` lookup for the client name. On submit, `POST`s name/email/password to `/api/auth/sign-up/email`, then `POST`s `/api/auth/oauth2/continue` (body `{ created: true, oauth_query }`) and redirects the browser to the `url` in that JSON response.
- `src/routes/consent.tsx` — the consent page. Reads `client_id`/`scope` off the query string, seeds the displayed client name with the raw `client_id` and upgrades it via the same `public-client-prelogin` lookup once it resolves. "Allow"/"Deny" both `POST` `/api/auth/oauth2/consent` (body `{ accept, oauth_query }`) and redirect the browser to the `url` in the JSON response.
- `src/routeTree.gen.ts` — **generated** by the TanStack Router Vite plugin (`autoCodeSplitting: true`) from `src/routes/`. Don't hand-edit; let the dev server regenerate it.

All three pages talk to `/api/auth/*` with same-origin `fetch` (no CORS needed — they're served from the same origin as the Worker) and drive the flow entirely client-side; none of them are server-rendered anymore.

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
- `test` / `test:run` — Vitest via `@cloudflare/vitest-pool-workers` (`vitest.config.mjs`, mirroring `worker-auth`'s pattern), reading `wrangler.jsonc` for bindings and applying Drizzle migrations to a test D1 instance through a `setupFiles` hook (`test/apply-migrations.ts`, calling `applyD1Migrations` — safe to run more than once). Three files under `test/`: `cors.test.ts` (the three cross-origin CORS exceptions in `worker/index.ts`), `register-worker-admin-client.test.ts` (the bootstrap route's auth/validation/idempotency), and `oauth-client-flow.test.ts` (a full sign-up → consent → token-exchange run against a freshly bootstrapped client, using the same PKCE-pair helper `apps/worker-auth/test/oauth-provider.test.ts` uses). `test/helpers/call-app.ts` (`callAsApp`) wraps `worker/index.ts`'s Hono `app.fetch` with a Miniflare execution context and lets a call override `env` per-request (e.g. a fixed `BETTER_AUTH_SECRET` for the bootstrap-route tests).

**Known gap:** there are no automated tests for the three React page components (`src/routes/login.tsx`, `signup.tsx`, `consent.tsx`) — same precedent as `apps/worker-admin/CLAUDE.md` notes for its own `login.tsx`/`auth-callback.tsx`. They're exercised only by the manual dev-server smoke check below and, ultimately, by a real browser click-through, which hasn't happened yet for this rewrite.

`.dev.vars.example` lists the required local vars (`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`); copy it to `.dev.vars` (gitignored) and fill in a real secret before running `dev`. Run `npm run migrations:auth` before first use.

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

which returns `{"client_id": "..."}` (idempotent — re-running it just returns the existing client's id). From there, `worker-admin` redirects to this worker's `/api/auth/oauth2/authorize`, the visitor authenticates against the `/login`/`/signup` SPA routes above and grants consent on `/consent`, and `worker-admin` exchanges the resulting authorization code for tokens at `/api/auth/oauth2/token`. Registering a second client (a different Worker, or a non-loopback deployment) means calling the same bootstrap route with that client's own `redirect_uri` — the route only ever registers a client named `worker-admin`, so a genuinely different client would need either a parameterized variant of this route or a one-off equivalent call through `auth.api.adminCreateOAuthClient` directly.
