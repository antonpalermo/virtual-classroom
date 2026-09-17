# CLAUDE.md — worker-oidc

`@capstone/openid-connect` — email/password sign-in backed by D1 via Drizzle, plus Better Auth's `oauthProvider` plugin (from `@better-auth/oauth-provider`) so this worker serves a real OIDC provider (`/.well-known/openid-configuration`, `/api/auth/oauth2/{authorize,token,userinfo,introspect,revoke,end-session}`, `/api/auth/jwks`). `apps/worker-admin` is registered as a public, PKCE-required, native-app OAuth client (via the bootstrap route below) and drives the full Authorization Code + PKCE flow against this worker — see `apps/worker-admin/CLAUDE.md` for the client side. This worker also hosts its own `/login`, `/signup`, and `/consent` pages (`src/pages.ts`) — plain server-rendered HTML+JS, not a SPA.

## Layout

- `src/index.ts` — Hono app. Serves a trivial `/` health route, registers the bootstrap route (`registerBootstrapRoute`, see below) and the login/signup/consent pages (`registerOidcPages`, see below), opens CORS on three endpoints called directly cross-origin from `worker-admin`'s browser JS (`/api/auth/jwks`, `/api/auth/oauth2/userinfo`, `/api/auth/oauth2/token` — none of them cookie-gated, same reasoning `worker-auth` applies to its own `/api/auth/jwks`), and mounts Better Auth's handler at `/api/auth/*` unmodified for everything else.
- `src/auth.ts` — `createAuth(db, env)`, the Better Auth factory: Drizzle/D1 adapter, `emailAndPassword` enabled, `jwt()` + `oauthProvider({ loginPage: '/login', consentPage: '/consent', signup: { page: '/signup' } })` plugins. `jwt()` is a hard dependency of `oauthProvider` (it signs OIDC `id_token`s; omitting it throws `BetterAuthError("jwt_config")` at request time), not an optional pairing. `loginPage`/`consentPage`/`signup.page` now correspond to real routes — `src/pages.ts` serves all three. `trustedOrigins` includes `env.BETTER_AUTH_URL` (redundant — Better Auth already auto-trusts its own configured `baseURL` origin) and, notably, `'https://example.com'`, needed so the test suite's synthetic cross-origin requests (the `/oauth2/consent` POST in particular, which carries both a session cookie and an `Origin` header) pass `originCheckMiddleware`. Built as a factory rather than a module-level singleton because the D1 binding only exists inside a request's `env`.
- `src/pages.ts` — `registerOidcPages(app)`, mounts `GET /login`, `GET /signup`, and `GET /consent`. All three return hand-written HTML with an inline `<script>`: `/login` posts to `/api/auth/sign-in/email` then redirects to `/api/auth/oauth2/authorize` (preserving the original query string) to resume the flow; `/signup` posts to `/api/auth/sign-up/email` then to `/api/auth/oauth2/continue`; `/consent` looks up the requesting client's `client_name` via `auth.api.getOAuthClientPublic` (falling back to the raw `client_id` if that lookup fails) and posts the visitor's accept/deny choice to `/api/auth/oauth2/consent`. User-supplied values (e.g. an unrecognized `client_id` reflected into the consent page) are HTML-escaped via a local `escapeHtml` helper.
- `src/register-worker-admin-client.ts` — `registerBootstrapRoute(app)`, mounts `POST /internal/oauth-clients/worker-admin`. Gated by a `Bearer <BETTER_AUTH_SECRET>` header (401 otherwise) and a required `redirect_uri` query param (400 otherwise). Idempotent: looks up an existing `oauth_client` row named `worker-admin` first and returns its `client_id` if found; otherwise it synthesizes a throwaway session directly on the shared `AuthContext` (there's no real signed-in user in this bootstrap flow, but the plugin's `adminCreateOAuthClient` unconditionally requires a session) against a fixed upserted "bootstrap" user row, then calls `adminCreateOAuthClient` to create a public client (`token_endpoint_auth_method: 'none'`, `application_type: 'native'` — required so loopback `http://localhost:...` redirect URIs validate, `skip_consent: false`, `grant_types: ['authorization_code']`). A concurrent duplicate insert (caught via `oauthClient.name`'s unique index) is treated as a race loss, not an error — the loser re-reads and returns the winner's `client_id`. Called once per environment via a manual curl (see `apps/worker-admin/CLAUDE.md`), never by a client itself.
- `src/db/client.ts` — `createDb(d1)`, wraps the `OIDC_DB` binding in a Drizzle client.
- `src/db/schema.ts` — **generated** by `npx auth@latest generate` (see `auth.cli.ts` below), then owned/hand-edited from there. Don't hand-author from scratch; regenerate after adding/changing plugins.
- `auth.cli.ts` — Node-only shim used solely by the Better Auth CLI to generate `src/db/schema.ts` (the CLI can't see a real D1 binding). Never imported by the Worker itself.
- `drizzle.config.ts` / `drizzle/*.sql` — `drizzle-kit`-generated migrations, applied via `wrangler d1 migrations apply OIDC_DB` (uses the `migrations_dir` set in `wrangler.jsonc`).
- `worker-configuration.d.ts` — **generated** by `wrangler types`; don't Read it in full — `grep` for the specific binding/type you need. Note `wrangler types` also picks up keys from a local `.dev.vars` file (not `.dev.vars.example`) to type `BETTER_AUTH_SECRET`/`BETTER_AUTH_URL` on `Env` — an untyped `env.BETTER_AUTH_*` reference usually means `.dev.vars` is missing locally.

## Regenerating the schema after a config change

`auth@latest` can resolve to a version bundling a newer, schema-incompatible `@better-auth/core` than this workspace's pinned `better-auth@^1.7.1` — pin the CLI version to match and review the generated diff (`git diff src/db/schema.ts`, expecting only additive changes) before running `drizzle-kit generate`.

```bash
npx auth@1.7.1 generate --config ./auth.cli.ts --adapter drizzle --dialect sqlite --output src/db/schema.ts -y
npx drizzle-kit generate
```

## Commands (run from this directory, or via `npm run <script> -w @capstone/openid-connect` from root)

- `dev` / `start` — `wrangler dev` (local port `8791`, inspector `9233` — set in `wrangler.jsonc`'s `dev` block; 8787/9229, 8788/9231, 8789/9230, and 8790/9232 are taken by worker-client, worker-realtime, worker-auth, and worker-admin respectively)
- `deploy` — `wrangler deploy`
- `typegen` — `wrangler types` (regenerates `worker-configuration.d.ts`)
- `migrations:auth` — `wrangler d1 migrations apply worker-oidc --local`, applies pending Drizzle migrations to the local D1
- `test` / `test:run` — Vitest via `@cloudflare/vitest-pool-workers` (`vitest.config.mjs`, mirroring `worker-auth`'s pattern), reading `wrangler.jsonc` for bindings and applying Drizzle migrations to a test D1 instance through a `setupFiles` hook (`test/apply-migrations.ts`, calling `applyD1Migrations` — safe to run more than once). Four files under `test/`: `cors.test.ts` (the three cross-origin CORS exceptions in `src/index.ts`), `pages.test.ts` (the `/login`, `/signup`, `/consent` HTML, including that an unrecognized `client_id` gets HTML-escaped rather than reflected raw), `register-worker-admin-client.test.ts` (the bootstrap route's auth/validation/idempotency), and `oauth-client-flow.test.ts` (a full sign-up → consent → token-exchange run against a freshly bootstrapped client, using the same PKCE-pair helper `apps/worker-auth/test/oauth-provider.test.ts` uses). `test/helpers/call-app.ts` (`callAsApp`) wraps `src/index.ts`'s Hono `app.fetch` with a Miniflare execution context and lets a call override `env` per-request (e.g. a fixed `BETTER_AUTH_SECRET` for the bootstrap-route tests).

`.dev.vars.example` lists the required local vars (`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`); copy it to `.dev.vars` (gitignored) and fill in a real secret before running `dev`. Run `npm run migrations:auth` before first use.

## Connecting a client

`apps/worker-admin` is the one real client today, connected via the bootstrap route (`src/register-worker-admin-client.ts`) plus the Authorization Code + PKCE flow it drives — see `apps/worker-admin/CLAUDE.md` for the full step-by-step. In short: bootstrap it once per environment with

```bash
curl -X POST "http://localhost:8791/internal/oauth-clients/worker-admin?redirect_uri=http://localhost:8790/auth-callback" \
    -H "Authorization: Bearer <this worker's BETTER_AUTH_SECRET>"
```

which returns `{"client_id": "..."}` (idempotent — re-running it just returns the existing client's id). From there, `worker-admin` redirects to this worker's `/api/auth/oauth2/authorize`, the visitor authenticates against the `/login`/`/signup` pages above and grants consent on `/consent`, and `worker-admin` exchanges the resulting authorization code for tokens at `/api/auth/oauth2/token`. Registering a second client (a different Worker, or a non-loopback deployment) means calling the same bootstrap route with that client's own `redirect_uri` — the route only ever registers a client named `worker-admin`, so a genuinely different client would need either a parameterized variant of this route or a one-off equivalent call through `auth.api.adminCreateOAuthClient` directly.
