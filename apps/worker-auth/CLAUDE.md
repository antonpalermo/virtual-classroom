# CLAUDE.md — worker-auth

`@capstone/auth` — the identity worker. A Cloudflare Worker that owns all user/session/credential data for the whole monorepo: Google sign-in/sign-up via Better Auth, backed by D1, plus Better Auth's `oauthProvider` plugin so future applications can link in as OAuth clients instead of touching this worker's database directly.

## Layout

- `src/index.ts` — Hono app. Serves a trivial `/` health route and mounts Better Auth's handler at `/api/auth/*`.
- `src/auth.ts` — `createAuth(db, env)`, the Better Auth factory (Google social provider, `role` additional field, `jwt` + `oauthProvider` plugins). Built as a factory rather than a module-level singleton because the D1 binding only exists inside a request's `env`.
- `src/db/client.ts` — `createDb(d1)`, wraps the `AUTH_DB` binding in a Drizzle client.
- `src/db/schema.ts` — **generated** by `npx auth@latest generate` (see `auth.cli.ts` below), then owned/hand-edited from there. Don't hand-author from scratch; regenerate after adding/changing plugins.
- `auth.cli.ts` — Node-only shim used solely by the Better Auth CLI to generate `src/db/schema.ts` (the CLI can't see a real D1 binding). Never imported by the Worker itself.
- `drizzle.config.ts` / `drizzle/*.sql` — `drizzle-kit`-generated migrations, applied via `wrangler d1 migrations apply AUTH_DB` (uses the `migrations_dir` set in `wrangler.jsonc`).
- `worker-configuration.d.ts` — **generated** by `wrangler types`; don't Read it in full — `grep` for the specific binding/type you need.

## Regenerating the schema after a config change

```bash
npx auth@latest generate --config ./auth.cli.ts --adapter drizzle --dialect sqlite --output src/db/schema.ts
npx drizzle-kit generate
```

## Testing

`@cloudflare/vitest-pool-workers` runs tests inside the real Workers runtime against a real local D1 (migrations applied automatically via `test/apply-migrations.ts`). Outbound calls to Google are mocked with `@msw/cloudflare` (`test/helpers/google-network.ts`) so the full sign-in/callback path runs deterministically without a real Google account. Run: `npm test` (watch) or `npm run test:run` (single run).

One thing the automated suite can't cover: an actual round trip through Google's real consent screen. That's a manual, one-time check via `wrangler dev` with a real Google Cloud OAuth client — see the auth worker design spec's Testing section.

## Commands (run from this directory, or via `npm run <script> -w @capstone/auth` from root)

- `dev` / `start` — `wrangler dev`
- `deploy` — `wrangler deploy`
- `typegen` — `wrangler types` (regenerates `worker-configuration.d.ts`)
- `test` / `test:run` — Vitest

No code here talks to `worker-client` or `worker-realtime` yet — this worker deploys independently. See the [auth worker design spec](../../docs/superpowers/specs/2026-08-26-auth-worker-design.md) for what's deliberately deferred (roles/permissions design, wiring up consumers, additional identity providers, custom domain).
