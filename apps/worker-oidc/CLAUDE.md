# CLAUDE.md — worker-oidc

`@capstone/openid-connect` — empty scaffold, not yet implemented.

## Layout

- `src/index.ts` — Hono app. Serves a trivial `/` health route.
- `wrangler.jsonc` — no bindings yet.
- `worker-configuration.d.ts` — **generated** by `wrangler types`; don't Read it in full — `grep` for the specific binding/type you need.

## Commands (run from this directory, or via `npm run <script> -w @capstone/openid-connect` from root)

- `dev` / `start` — `wrangler dev`
- `deploy` — `wrangler deploy`
- `typegen` — `wrangler types` (regenerates `worker-configuration.d.ts`)
