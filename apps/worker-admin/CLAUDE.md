# CLAUDE.md — worker-admin

`@capstone/admin` — the admin worker. A separately deployed Cloudflare Worker for admin tasks (user management, role assignment), kept apart from `worker-client` so the client bundle/deploy stays unrelated to admin surface area.

A React 19 + TanStack Router SPA (built with Vite, served by the Worker as static assets via `@cloudflare/vite-plugin`) provides a working sign-in flow and user-management dashboard. Same shape as `apps/worker-client`.

## Layout

- `worker/index.ts` — the whole backend: a bare `ExportedHandler` that forwards any `/api/auth/*` request to `AUTH_SERVICE` (a service binding to `worker-auth`) and 404s everything else. Byte-for-byte the same shape as `apps/worker-client/worker/index.ts`'s passthrough.
- `src/` — the frontend SPA. `src/main.tsx` entry point, `src/lib/auth-client.ts` (the `better-auth/react` client, configured with the `adminClient()` plugin and a global bearer-token `fetchOptions.auth` reading from `sessionStorage`; exports `authClient` plus the `sessionStorage` accessors for the two stored credentials — `getStoredSession`/`storeSession`/`clearStoredSession` for the bearer session token, `getStoredJwt`/`storeJwt`/`clearStoredJwt` for the signed access token), `src/routes/` file-based routes (`__root.tsx`, `login.tsx`, `auth-callback.tsx`, `index.tsx` — the dashboard), `src/routeTree.gen.ts` **generated** by the TanStack Router Vite plugin from `src/routes/` — don't hand-edit, let the dev server regenerate it.
- `worker-configuration.d.ts` — **generated** by `wrangler types` (`typegen` script); don't Read it in full (blocked via `.claude/settings.json` deny rule) — `grep` for the specific binding/type you need.

## Why this worker has no logic of its own

Better Auth's `admin` plugin (configured in `apps/worker-auth/src/auth.ts`) mounts its routes under the auth instance's own basePath — `/api/auth/admin/*` — so proxying all of `/api/auth/*` already exposes every admin operation (list/search users, `set-role`, ban/unban, remove, impersonate). `worker-auth` is the single place that decides who's allowed to call them; this worker deliberately does not duplicate that check, so there's only one place authorization logic can drift out of sync. See `docs/superpowers/specs/2026-09-12-worker-admin-design.md` for the full design.

## Sign-in flow

`src/routes/login.tsx` redirects straight to worker-auth's own hosted login — no hop through `worker-client` anymore. worker-auth hosts `/login` and `/login/complete` itself (see `apps/worker-auth/CLAUDE.md`), so this worker links directly to it:

1. `src/routes/login.tsx` links to worker-auth's `/login?returnTo=<this origin>/auth-callback`.
2. The visitor signs in with Google on worker-auth's hosted login page. On success, worker-auth redirects to `returnTo` with `#token=<jwt>&session=<bearer session token>` appended to the URL fragment, both `encodeURIComponent`-encoded.
3. `src/routes/auth-callback.tsx` reads both values off the fragment via `URLSearchParams`, storing them separately in `sessionStorage` (`storeJwt` for the signed access token, `storeSession` for the bearer session token — both in `src/lib/auth-client.ts`), then redirects to `/`.
4. `src/routes/index.tsx`'s dashboard `beforeLoad` redirects to `/login` if no JWT is stored. Once loaded, it verifies the stored JWT locally via `verifyAccessToken` (`@capstone/auth-verify`) against worker-auth's JWKS endpoint, and gates the UI on the resulting claims' `role` — "Access denied" for a `user`-role viewer, a user list with role/ban/remove controls for `admin`/`manager`. The admin-plugin mutations themselves (`authClient.admin.setRole`/`banUser`/`unbanUser`/`removeUser`) still use the bearer session token (`getStoredSession`) unchanged — the JWT is only ever used for local role/identity display, never to authorize a mutation. A `manager` viewer never sees `admin` as a grantable role and every control is disabled on a row whose current role is `admin` — UX-layer mirroring of `worker-auth`'s `manager-restrictions.ts` hook, not the actual enforcement (that always happens server-side).

See `docs/superpowers/specs/2026-09-14-admin-user-roles-dashboard-design.md` for the original dashboard design and `docs/superpowers/specs/2026-09-15-central-idp-hosted-login-design.md` for the hosted-login rework.

### Calling the API directly

The curl workflow still works as a fallback for scripting/debugging, independent of the UI above: sign in through worker-auth's hosted login as usual (via this worker's own `/login`, or any other app pointed at the same worker-auth instance), grab your session's bearer token (Better Auth's `bearer` plugin returns one via a `set-auth-token` response header on any request that touches your session, e.g. `get-session`), and call this worker with it:

```bash
curl -H "Authorization: Bearer <token>" http://localhost:8790/api/auth/admin/list-users
```

The very first admin account is granted via `worker-auth`'s `ADMIN_USER_IDS` env var (a comma-separated list of Better Auth user ids) — see `apps/worker-auth/CLAUDE.md`. Once at least one admin exists, further admins are promoted via `POST /api/auth/admin/set-role` (or the dashboard's role selector).

## Commands (run from this directory, or via `npm run <script> -w @capstone/admin` from root)

- `dev` — `vite` (fixed local port `8790`, inspector `9232` — see `vite.config.ts`)
- `build` — `tsc -b && vite build`
- `preview` — `npm run build && vite preview`
- `deploy` — `npm run build && wrangler deploy`
- `typegen` — `wrangler types` (regenerates `worker-configuration.d.ts`)
- `test` / `test:run` — Vitest (`@cloudflare/vitest-pool-workers`, with `AUTH_SERVICE` mocked in `vitest.config.mjs` — no real `worker-auth` instance needed to run these tests)

## TypeScript config

`tsconfig.json` is a references-only shell pointing at `tsconfig.app.json` (browser/React code under `src/`), `tsconfig.node.json` (Vite config), and `tsconfig.worker.json` (the backend under `worker/`, typed against `worker-configuration.d.ts`) — all three extending the shared bases in `@capstone/typescript/configs/` (see `packages/config-typescript/CLAUDE.md`). Same shape as `apps/worker-client`.
