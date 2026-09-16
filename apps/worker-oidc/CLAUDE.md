# CLAUDE.md — worker-oidc

`@capstone/openid-connect` — Better Auth basics: email/password sign-in backed by D1 via Drizzle. No social providers, no OAuth/OIDC-provider plugins yet — this is scaffolding, not `worker-auth`'s identity worker.

## Layout

- `src/index.ts` — Hono app. Serves a trivial `/` health route and mounts Better Auth's handler at `/api/auth/*` unmodified.
- `src/auth.ts` — `createAuth(db, env)`, the Better Auth factory: Drizzle/D1 adapter, `emailAndPassword` enabled, nothing else. Built as a factory rather than a module-level singleton because the D1 binding only exists inside a request's `env`.
- `src/db/client.ts` — `createDb(d1)`, wraps the `OIDC_DB` binding in a Drizzle client.
- `src/db/schema.ts` — **generated** by `npx auth@latest generate` (see `auth.cli.ts` below), then owned/hand-edited from there. Don't hand-author from scratch; regenerate after adding/changing plugins.
- `auth.cli.ts` — Node-only shim used solely by the Better Auth CLI to generate `src/db/schema.ts` (the CLI can't see a real D1 binding). Never imported by the Worker itself.
- `drizzle.config.ts` / `drizzle/*.sql` — `drizzle-kit`-generated migrations, applied via `wrangler d1 migrations apply OIDC_DB` (uses the `migrations_dir` set in `wrangler.jsonc`).
- `worker-configuration.d.ts` — **generated** by `wrangler types`; don't Read it in full — `grep` for the specific binding/type you need. Note `wrangler types` also picks up keys from a local `.dev.vars` file (not `.dev.vars.example`) to type `BETTER_AUTH_SECRET`/`BETTER_AUTH_URL` on `Env` — an untyped `env.BETTER_AUTH_*` reference usually means `.dev.vars` is missing locally.

## Regenerating the schema after a config change

Same version-drift caveat as `worker-auth` (see [apps/worker-auth/CLAUDE.md](../worker-auth/CLAUDE.md)): pin the `auth@latest` CLI's version to this workspace's `better-auth` version and review the generated diff before running `drizzle-kit generate`.

```bash
npx auth@1.7.1 generate --config ./auth.cli.ts --adapter drizzle --dialect sqlite --output src/db/schema.ts -y
npx drizzle-kit generate
```

## Commands (run from this directory, or via `npm run <script> -w @capstone/openid-connect` from root)

- `dev` / `start` — `wrangler dev`
- `deploy` — `wrangler deploy`
- `typegen` — `wrangler types` (regenerates `worker-configuration.d.ts`)
- `migrations:auth` — `wrangler d1 migrations apply worker-oidc --local`, applies pending Drizzle migrations to the local D1

`.dev.vars.example` lists the required local vars (`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`); copy it to `.dev.vars` (gitignored) and fill in a real secret before running `dev`. Run `npm run migrations:auth` before first use.

No test suite yet — unlike `worker-auth`, there's no `@cloudflare/vitest-pool-workers` setup here. Add one if/when this grows real logic worth covering.
