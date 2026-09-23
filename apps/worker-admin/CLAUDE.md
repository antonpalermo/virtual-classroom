# CLAUDE.md — worker-admin

`@capstone/admin` — the admin worker. A separately deployed Cloudflare Worker, kept apart from `worker-client` so the client bundle/deploy stays unrelated to admin surface area.

A React 19 + TanStack Router SPA (built with Vite, served as static assets via `@cloudflare/vite-plugin` in dev and the `assets` config in `wrangler.jsonc` when deployed) provides a sign-in flow against `apps/worker-oidc`. There is no backend Worker anymore — no `worker/` directory, no service bindings — this is a fully static SPA. There is also no user-management dashboard: the previous Better-Auth-admin-plugin dashboard (role assignment, ban/unban, remove) was dropped entirely when this worker moved off `worker-auth`, and is deferred to a future plan. Once signed in, the only thing shown is "Signed in as `<email>`" plus a sign-out button.

## Layout

- `src/main.tsx` — entry point, mounts the TanStack Router `RouterProvider`.
- `src/lib/pkce.ts` — `createPkcePair()`, generates a random `code_verifier` and its S256 `code_challenge` (both base64url) using Web Crypto — the PKCE pair for the Authorization Code + PKCE flow below.
- `src/lib/auth-client.ts` — `sessionStorage` accessors for the one stored credential: `getStoredJwt`/`storeJwt`/`clearStoredJwt`, keyed as `admin_jwt`. That's the only thing this worker persists now — no bearer session token, no `better-auth/react` client, no `adminClient()` plugin.
- `src/routes/` — file-based routes: `__root.tsx` (bare `Outlet` + `TanStackRouterDevtools`), `login.tsx`, `auth-callback.tsx`, `index.tsx` (the signed-in view — see Sign-in flow below).
- `src/routeTree.gen.ts` — **generated** by the TanStack Router Vite plugin from `src/routes/` — don't hand-edit, let the dev server regenerate it.
- `worker-configuration.d.ts` — **generated** by `wrangler types` (`typegen` script); don't Read it in full (blocked via `.claude/settings.json` deny rule) — `grep` for the specific binding/type you need.

## Sign-in flow

Authorization Code + PKCE against `apps/worker-oidc`'s OAuth provider, with `worker-oidc` hosting its own login/consent pages (React routes under `src/routes/` there — see `apps/worker-oidc/CLAUDE.md`). There is no sign-up: `worker-oidc` has none, so accounts have to be seeded ahead of time via `worker-oidc`'s `worker/bootstrap-admin-user.ts`.

1. `src/routes/login.tsx`'s "Sign in" button calls `createPkcePair()`, generates a random `state` (`crypto.randomUUID()`), and stashes `codeVerifier`/`state` in `sessionStorage` (`oidc_code_verifier`, `oidc_state`). It then redirects to `worker-oidc`'s `/api/auth/oauth2/authorize` with `client_id` (from `VITE_OIDC_CLIENT_ID`), `redirect_uri` (`<this origin>/auth-callback`), `response_type=code`, `scope=openid email profile`, the PKCE `code_challenge`/`code_challenge_method=S256`, and `state`.
2. The visitor authenticates on `worker-oidc`'s own hosted `/login` page and, if it's their first time authorizing this client, its `/consent` page.
3. `worker-oidc` redirects back to `redirect_uri` (this worker's `/auth-callback`) with `?code=...&state=...`.
4. `src/routes/auth-callback.tsx` reads `code`/`state` off the query string, checks `state` against the stashed `oidc_state`, retrieves `oidc_code_verifier`, and clears both from `sessionStorage`. It then `POST`s `worker-oidc`'s `/api/auth/oauth2/token` (`grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`, `code_verifier`, form-urlencoded) directly from the browser (no backend hop). On success it takes the response's `id_token`, stores it via `storeJwt` (`src/lib/auth-client.ts`), and navigates to `/`. Any failure (missing/mismatched state, non-OK response, missing `id_token`) sends the visitor back to `/login`.
5. `src/routes/index.tsx`'s `beforeLoad` redirects to `/login` if no JWT is stored. Once mounted, it verifies the stored JWT locally via `verifyAccessToken` (`@capstone/auth-verify`) against `worker-oidc`'s JWKS endpoint (`${VITE_OIDC_ORIGIN}/api/auth/jwks`). A stale/invalid token clears storage and redirects to `/login`; a valid one renders "Signed in as `<claims.email>`" and a Sign out button (`clearStoredJwt` + navigate to `/login`).

Both `login.tsx` and `auth-callback.tsx` default `VITE_OIDC_ORIGIN` to `http://localhost:8791` (worker-oidc's local dev port) when the env var isn't set; `VITE_OIDC_CLIENT_ID` has no fallback and must be supplied (see below).

### Bootstrapping a client against worker-oidc

Nothing in `worker-oidc` self-registers this worker as an OAuth client — it's a one-time (idempotent) manual call against `worker-oidc`'s bootstrap route (`apps/worker-oidc/worker/register-worker-admin-client.ts`), gated by `worker-oidc`'s own `BETTER_AUTH_SECRET`:

```bash
curl -X POST "http://localhost:8791/internal/oauth-clients/worker-admin?redirect_uri=http://localhost:8790/auth-callback" \
    -H "Authorization: Bearer <worker-oidc's BETTER_AUTH_SECRET>"
```

This registers (or, if already registered, just looks up) a public, PKCE-required, native-app OAuth client named `worker-admin` and returns `{"client_id": "..."}`. Copy that `client_id` into this worker's `.env` (copy `.env.example`, gitignored) as `VITE_OIDC_CLIENT_ID`, alongside `VITE_OIDC_ORIGIN` pointing at `worker-oidc`. Re-run the same curl against whatever `worker-oidc` deployment/redirect URI you're targeting (e.g. a deployed `worker-admin` origin) to get (or confirm) the `client_id` for that environment.

## Commands (run from this directory, or via `npm run <script> -w @capstone/admin` from root)

- `dev` — `vite` (fixed local port `8790`, inspector `9232` — see `vite.config.ts`)
- `build` — `tsc -b && vite build`
- `preview` — `npm run build && vite preview`
- `deploy` — `npm run build && wrangler deploy` (uploads the built static assets only — there's no Worker logic to deploy)
- `typegen` — `wrangler types` (regenerates `worker-configuration.d.ts`)
- `test` / `test:run` — plain Vitest (`vitest.config.mjs` is an empty config — no `@cloudflare/vitest-pool-workers`, since there's no Worker runtime code left to test against). Only `test/pkce.test.ts` exists today, covering `createPkcePair()`'s shape and the S256 challenge derivation.

## TypeScript config

`tsconfig.json` is a references-only shell pointing at `tsconfig.app.json` (browser/React code under `src/`, plus `test/`) and `tsconfig.node.json` (`vite.config.ts`) — both extending the shared bases in `@capstone/typescript/configs/` (see `packages/config-typescript/CLAUDE.md`). There is no `tsconfig.worker.json` anymore — with the backend Worker deleted, there's no code left that types against `worker-configuration.d.ts` (the `typegen` script still regenerates it, but nothing under `src/` currently imports `Env` or any other type from it).
