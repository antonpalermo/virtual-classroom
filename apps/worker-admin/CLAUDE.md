# CLAUDE.md — worker-admin

`@capstone/admin` — the admin worker. A separately deployed Cloudflare Worker for admin tasks (user management, role assignment), kept apart from `worker-client` so the client bundle/deploy stays unrelated to admin surface area.

A React 19 + TanStack Router SPA (built with Vite, served by the Worker as static assets via `@cloudflare/vite-plugin`) is scaffolded but currently just a placeholder page — the user-management UI itself hasn't been built yet. Same shape as `apps/worker-client`.

## Layout

- `worker/index.ts` — the whole backend: a bare `ExportedHandler` that forwards any `/api/auth/*` request to `AUTH_SERVICE` (a service binding to `worker-auth`) and 404s everything else. Byte-for-byte the same shape as `apps/worker-client/worker/index.ts`'s passthrough.
- `src/` — the frontend SPA. `src/main.tsx` entry point, `src/routes/` file-based routes (`__root.tsx`, `index.tsx` — currently just a placeholder page), `src/routeTree.gen.ts` **generated** by the TanStack Router Vite plugin from `src/routes/` — don't hand-edit, let the dev server regenerate it.
- `worker-configuration.d.ts` — **generated** by `wrangler types` (`typegen` script); don't Read it in full (blocked via `.claude/settings.json` deny rule) — `grep` for the specific binding/type you need.

## Why this worker has no logic of its own

Better Auth's `admin` plugin (configured in `apps/worker-auth/src/auth.ts`) mounts its routes under the auth instance's own basePath — `/api/auth/admin/*` — so proxying all of `/api/auth/*` already exposes every admin operation (list/search users, `set-role`, ban/unban, remove, impersonate). `worker-auth` is the single place that decides who's allowed to call them; this worker deliberately does not duplicate that check, so there's only one place authorization logic can drift out of sync. See `docs/superpowers/specs/2026-09-12-worker-admin-design.md` for the full design.

## Calling the API directly

The scaffolded UI doesn't call the admin API yet. Since Google's OAuth `redirect_uri` (and so the session cookie) is pinned to `worker-client`'s origin, an admin session can't be picked up here via cookie. Instead, sign in through `worker-client` as usual, grab your session's bearer token (Better Auth's `bearer` plugin returns one via a `set-auth-token` response header on any request that touches your session, e.g. `get-session`), and call this worker with it:

```bash
curl -H "Authorization: Bearer <token>" http://localhost:8790/api/auth/admin/list-users
```

The very first admin account is granted via `worker-auth`'s `ADMIN_USER_IDS` env var (a comma-separated list of Better Auth user ids) — see `apps/worker-auth/CLAUDE.md`. Once at least one admin exists, further admins are promoted via `POST /api/auth/admin/set-role`.

## Commands (run from this directory, or via `npm run <script> -w @capstone/admin` from root)

- `dev` — `vite` (fixed local port `8790`, inspector `9232` — see `vite.config.ts`)
- `build` — `tsc -b && vite build`
- `preview` — `npm run build && vite preview`
- `deploy` — `npm run build && wrangler deploy`
- `typegen` — `wrangler types` (regenerates `worker-configuration.d.ts`)
- `test` / `test:run` — Vitest (`@cloudflare/vitest-pool-workers`, with `AUTH_SERVICE` mocked in `vitest.config.mjs` — no real `worker-auth` instance needed to run these tests)

## TypeScript config

`tsconfig.json` is a references-only shell pointing at `tsconfig.app.json` (browser/React code under `src/`), `tsconfig.node.json` (Vite config), and `tsconfig.worker.json` (the backend under `worker/`, extending `@capstone/typescript/configs/tsconfig.worker.json` and typed against `worker-configuration.d.ts`). Same shape as `apps/worker-client`, except the worker config stays on the shared base rather than a local one.
