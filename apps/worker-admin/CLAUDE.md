# CLAUDE.md — worker-admin

`@capstone/admin` — the admin worker. A separately deployed Cloudflare Worker, kept apart from `worker-client` so the client bundle/deploy stays unrelated to admin surface area.

A React 19 + TanStack Router SPA (built with Vite, served as static assets via `@cloudflare/vite-plugin` in dev and the `assets` config in `wrangler.jsonc` when deployed) provides a sign-in flow against `apps/worker-oidc`. There is no backend Worker anymore — no `worker/` directory, no service bindings — this is a fully static SPA; every write (including the user-management CRUD below) goes straight from the browser to `worker-oidc`'s own REST API. Once signed in, `/` shows "Signed in as `<email>`" plus a sign-out button, and — for an `admin` — a link to `/users`.

There is a user-management dashboard again: `/users` (`src/routes/users.tsx`) lists, creates (via a one-time invite link — there's still no self-service sign-up anywhere in this system), edits the role of, bans/unbans, and deletes every user in `worker-oidc`'s shared D1, calling its `/api/admin/*` REST API (see `apps/worker-oidc/CLAUDE.md`'s "Admin user management" section for the full API and role-model detail). This is a fresh, hand-rolled implementation, not a resurrection of the old Better-Auth-`admin`-plugin dashboard dropped when this worker moved off `worker-auth` — that plugin's dashboard depended on bearer-session tokens this worker's OIDC/PKCE sign-in doesn't produce.

## Layout

- `src/main.tsx` — entry point, mounts the TanStack Router `RouterProvider`.
- `src/lib/pkce.ts` — `createPkcePair()`, generates a random `code_verifier` and its S256 `code_challenge` (both base64url) using Web Crypto — the PKCE pair for the Authorization Code + PKCE flow below.
- `src/lib/auth-client.ts` — `sessionStorage` accessors for the one stored credential: `getStoredJwt`/`storeJwt`/`clearStoredJwt`, keyed as `admin_jwt`. That's the only thing this worker persists now — no bearer session token, no `better-auth/react` client, no `adminClient()` plugin. The stored `id_token` doubles as the credential sent as `Authorization: Bearer` on every `/api/admin/*` call (see `users.tsx` below) — no separate access-token capture needed; `worker-oidc`'s admin API verifies it directly (`@capstone/auth-verify`'s `verifyAccessTokenWithJwks`, server-side) rather than trusting a bearer-session token this worker never has.
- `src/routes/` — file-based routes: `__root.tsx` (bare `Outlet` + `TanStackRouterDevtools`), `login.tsx`, `auth-callback.tsx`, `index.tsx` (the signed-in view — see Sign-in flow below), `users.tsx` (the user-management dashboard, admin-only — see below).
- `src/routeTree.gen.ts` — **generated** by the TanStack Router Vite plugin from `src/routes/` — don't hand-edit, let the dev server regenerate it.
- `worker-configuration.d.ts` — **generated** by `wrangler types` (`typegen` script); don't Read it in full (blocked via `.claude/settings.json` deny rule) — `grep` for the specific binding/type you need.

## Sign-in flow

Authorization Code + PKCE against `apps/worker-oidc`'s OAuth provider, with `worker-oidc` hosting its own login/consent pages (React routes under `src/routes/` there — see `apps/worker-oidc/CLAUDE.md`). There is still no *self-service* sign-up: an account either comes from `worker-oidc`'s one-off `worker/bootstrap-admin-user.ts` bootstrap (the very first admin) or from another admin creating it via this worker's `/users` dashboard (see below).

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

## User management (`src/routes/users.tsx`)

`beforeLoad` redirects to `/login` if no JWT is stored, same as `index.tsx`; once mounted it verifies the stored JWT the same way `index.tsx` does, then additionally requires `claims.role === 'admin'` — anyone else sees a plain "You're not authorized to manage users." message rather than the table (a UX nicety only; the real enforcement is server-side, on every call `worker-oidc`'s `/api/admin/*` API re-checks role fresh against its own D1, never trusting this token's `role` claim). Every request attaches the stored `id_token` as `Authorization: Bearer` — see `src/lib/auth-client.ts` above for why no separate access-token handling is needed.

Plain `<table>` (no UI library, matching the rest of this repo): email, an inline role `<select>` that `PATCH`es on change, ban status, and per-row Ban/Unban and Delete (behind a `window.confirm`) buttons, each re-fetching the list on success. A "Create user" form (name + email only, no password field) `POST`s to `/api/admin/users`; on success it renders the returned `inviteUrl` in a read-only `<input>` for the admin to copy and hand to the invitee out of band — there's no email-sending in this repo, so this is the entire hand-off mechanism (see `apps/worker-oidc/CLAUDE.md`'s "Admin user management" section for what happens when the invitee opens that link). A load/mutation error surfaces as a banner above the table; a self-targeted demote/ban/delete is rejected server-side (400) and surfaces the same way.

## Commands (run from this directory, or via `npm run <script> -w @capstone/admin` from root)

- `dev` — `vite` (fixed local port `8790`, inspector `9232` — see `vite.config.ts`)
- `build` — `tsc -b && vite build`
- `preview` — `npm run build && vite preview`
- `deploy` — `npm run build && wrangler deploy` (uploads the built static assets only — there's no Worker logic to deploy)
- `typegen` — `wrangler types` (regenerates `worker-configuration.d.ts`)
- `test` / `test:run` — plain Vitest (`vitest.config.mjs` is an empty config — no `@cloudflare/vitest-pool-workers`, since there's no Worker runtime code left to test against). Only `test/pkce.test.ts` exists today, covering `createPkcePair()`'s shape and the S256 challenge derivation. No automated tests for any of the React page components, `users.tsx` included — same precedent noted in `apps/worker-oidc/CLAUDE.md` for its own pages; exercised only by manual/browser checks.

## TypeScript config

`tsconfig.json` is a references-only shell pointing at `tsconfig.app.json` (browser/React code under `src/`, plus `test/`) and `tsconfig.node.json` (`vite.config.ts`) — both extending the shared bases in `@capstone/typescript/configs/` (see `packages/config-typescript/CLAUDE.md`). There is no `tsconfig.worker.json` anymore — with the backend Worker deleted, there's no code left that types against `worker-configuration.d.ts` (the `typegen` script still regenerates it, but nothing under `src/` currently imports `Env` or any other type from it).
