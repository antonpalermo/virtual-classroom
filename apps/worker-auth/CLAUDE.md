# CLAUDE.md — worker-auth

`@capstone/auth` — the identity worker. A Cloudflare Worker that owns all user/session/credential data for the whole monorepo: Google sign-in/sign-up via Better Auth, backed by D1, plus Better Auth's `oauthProvider` plugin so future applications can link in as OAuth clients instead of touching this worker's database directly.

## Layout

- `src/index.ts` — Hono app. Serves a trivial `/` health route and mounts Better Auth's handler at `/api/auth/*`.
- `src/auth.ts` — `createAuth(db, env)`, the Better Auth factory (Google social provider, `role` additional field, `jwt` + `oauthProvider` + `admin` + `bearer` plugins). Built as a factory rather than a module-level singleton because the D1 binding only exists inside a request's `env`.
- `src/db/client.ts` — `createDb(d1)`, wraps the `AUTH_DB` binding in a Drizzle client.
- `src/db/schema.ts` — **generated** by `npx auth@latest generate` (see `auth.cli.ts` below), then owned/hand-edited from there. Don't hand-author from scratch; regenerate after adding/changing plugins.
- `auth.cli.ts` — Node-only shim used solely by the Better Auth CLI to generate `src/db/schema.ts` (the CLI can't see a real D1 binding). Never imported by the Worker itself.
- `src/access-control.ts` — the `admin` plugin's Better Auth `ac` statement set and its three roles: `adminRole` and `managerRole` (identical statement sets — full parity on `user` and `session` operations) and `userRole` (none). `manager` isn't a separate mechanism from `admin`; it's granted through the same `role` column, just a different string value — see the `admin` plugin config in `src/auth.ts`.
- `src/manager-restrictions.ts` — a Better Auth plugin (`managerRestrictions`, registered in `src/auth.ts`'s `plugins` array) that 403s a `manager`-role session on `/admin/set-role`, `/admin/ban-user`, `/admin/unban-user`, `/admin/remove-user` when it's trying to grant the `admin` role or act on a user whose *current* role is already `admin`. This exists because `ac` can only check what the actor's role can do, not the target user's state or the requested value — the one piece of manager/admin parity `access-control.ts` can't express on its own.
- `drizzle.config.ts` / `drizzle/*.sql` — `drizzle-kit`-generated migrations, applied via `wrangler d1 migrations apply AUTH_DB` (uses the `migrations_dir` set in `wrangler.jsonc`).
- `worker-configuration.d.ts` — **generated** by `wrangler types`; don't Read it in full — `grep` for the specific binding/type you need.

## Regenerating the schema after a config change

`auth@latest` can resolve to a version bundling a newer, schema-incompatible `@better-auth/core` than this project's pinned `better-auth@^1.7.1` — this has silently dropped an existing column (`account.issuer` and its unique index) before, which `drizzle-kit generate` would then turn into a destructive migration. Pin the version to match, and review the generated diff (`git diff src/db/schema.ts`, expecting only additive changes) before running `drizzle-kit generate` on it.

```bash
npx auth@1.7.1 generate --config ./auth.cli.ts --adapter drizzle --dialect sqlite --output src/db/schema.ts -y
npx drizzle-kit generate
```

## Testing

`@cloudflare/vitest-pool-workers` runs tests inside the real Workers runtime against a real local D1 (migrations applied automatically via `test/apply-migrations.ts`). Tests call the app via `test/helpers/call-app.ts` (`callAsApp`). Outbound calls to Google are mocked with `@msw/cloudflare` (`test/helpers/google-network.ts`) so the full sign-in/callback path runs deterministically without a real Google account. Run: `npm test` (watch) or `npm run test:run` (single run).

One thing the automated suite can't cover: an actual round trip through Google's real consent screen. That's a manual, one-time check via `wrangler dev` with a real Google Cloud OAuth client — see the auth worker design spec's Testing section. Note that in local dev, `.dev.vars`' `BETTER_AUTH_URL` is set to `worker-client`'s origin (`http://localhost:5173`), not this worker's own — Better Auth derives both the Google `redirect_uri` and the session cookie's scope from `baseURL`, and requests only reach this worker proxied through `worker-client`'s service binding, so `worker-client`'s dev server needs to be running too for this manual check to work.

## Commands (run from this directory, or via `npm run <script> -w @capstone/auth` from root)

- `dev` / `start` — `wrangler dev`
- `deploy` — `wrangler deploy`
- `typegen` — `wrangler types` (regenerates `worker-configuration.d.ts`)
- `test` / `test:run` — Vitest

`ADMIN_USER_IDS` (comma-separated Better Auth user ids) bootstraps the first admin account(s) — see the `admin` plugin config in `src/auth.ts` and [apps/worker-admin/CLAUDE.md](../worker-admin/CLAUDE.md). To bootstrap the first admin: sign in once through the normal Google flow, then look up the resulting user id with `wrangler d1 execute AUTH_DB --command "select id, email from user"` (add `--remote` for the deployed DB; omit it for local dev). Set the id in `.dev.vars` for local dev, or `wrangler secret put ADMIN_USER_IDS` for a deployed worker — there's no `vars` entry for it in `wrangler.jsonc`. The list is read fresh from `env` on every `createAuth()` call, so `wrangler dev` picks up a `.dev.vars` change on the next request with no restart; a deployed Worker needs the new secret to finish propagating (or a fresh deploy) before it takes effect.

`worker-client` talks to this worker via a Cloudflare service binding (`AUTH_SERVICE` in `apps/worker-client/wrangler.jsonc`), proxying `/api/auth/*` requests through — see [docs/superpowers/specs/2026-08-27-client-auth-wiring-design.md](../../docs/superpowers/specs/2026-08-27-client-auth-wiring-design.md). `worker-admin` talks to this worker the same way (its own `AUTH_SERVICE` binding) and additionally relies on the `admin` and `bearer` plugins configured here — see [apps/worker-admin/CLAUDE.md](../worker-admin/CLAUDE.md) and [docs/superpowers/specs/2026-09-12-worker-admin-design.md](../../docs/superpowers/specs/2026-09-12-worker-admin-design.md). `worker-realtime` is not wired up yet. See the [auth worker design spec](../../docs/superpowers/specs/2026-08-26-auth-worker-design.md) for what's still deferred (additional identity providers, custom domain) and the worker-admin spec for the roles/permissions/admin-UI follow-up.

`BETTER_AUTH_URL` is set to `worker-client`'s origin, not this worker's own — see the Testing section above.
