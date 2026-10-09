# CLAUDE.md — worker-client

`@capstone/client` — the frontend. React 19 + TanStack Router SPA built with Vite, served as static assets via `@cloudflare/vite-plugin` in dev and the `assets` config in `wrangler.jsonc` when deployed. There is no backend Worker — no `worker/` directory, no service bindings — it's a fully static SPA, same shape as `apps/worker-admin`.

## Layout

- `src/main.tsx` — entry point.
- `src/components/app.tsx` — root component.
- `src/routes/` — file-based routes (`__root.tsx`, `index.tsx`, `room.tsx`, `auth-callback.tsx`). Add/edit files here to change routing.
- `src/lib/pkce.ts` — `createPkcePair()`, a copy of `apps/worker-admin`'s (random `code_verifier` + S256 `code_challenge`, base64url, via Web Crypto). `test/pkce.test.ts` covers it.
- `src/lib/auth-client.ts` — `sessionStorage` accessors for the one stored credential, the `id_token`: `getStoredJwt`/`storeJwt`/`clearStoredJwt`, keyed as `client_jwt` — plus `redirectToSignIn()`, which starts the sign-in flow below.
- `src/routeTree.gen.ts` — **generated** by the TanStack Router Vite plugin (`autoCodeSplitting: true`) from `src/routes/`. Don't hand-edit; let the dev server regenerate it.
- `worker-configuration.d.ts` — **generated** by `wrangler types` (`cf-typegen` script). Don't Read it in full (blocked via `.claude/settings.json` deny rule) — `grep` for the specific type you need instead. Nothing under `src/` imports from it today.

## Sign-in flow

Authorization Code + PKCE against `apps/worker-oidc`, same as `apps/worker-admin`'s (see `apps/worker-admin/CLAUDE.md` for the step-by-step), but with no sign-in page of its own. Every route except `/auth-callback` is gated by `src/routes/__root.tsx`'s `beforeLoad`: it verifies the stored token locally via `verifyAccessToken` (`@capstone/auth-verify`) against worker-oidc's `/api/auth/jwks` and exposes the claims as route context (`Route.useRouteContext()`); a missing or failing token is cleared and `redirectToSignIn()` (`src/lib/auth-client.ts`) stashes a PKCE verifier + `state` in `sessionStorage` and sends the browser straight to worker-oidc's `/api/auth/oauth2/authorize` with `prompt=login`, which lands on worker-oidc's `/login` (and `/consent`). `src/routes/auth-callback.tsx`'s `beforeLoad` checks `state`, exchanges the `code` at `/api/auth/oauth2/token` directly from the browser, stores the returned `id_token`, and redirects back to the page that triggered sign-in (`redirectToSignIn` stashes `pathname + search` as `oidc_return_to`; `takeReturnTo()` only returns same-origin paths, falling back to `/`, so a tampered value can't become an open redirect); any failure restarts sign-in. The exchange lives in `beforeLoad`, not a `useEffect`, because StrictMode double-runs effects in dev and the second run (verifier already consumed) would restart sign-in mid-exchange. Signing out clears the stored token and restarts sign-in; the worker-oidc session cookie survives, which is why `prompt=login` is sent — otherwise the next sign-in would silently reuse that session (including one left by a `worker-admin` sign-in on the same browser).

`VITE_OIDC_ORIGIN` defaults to `http://localhost:8791` (worker-oidc's dev port). `VITE_OIDC_CLIENT_ID` has no fallback — bootstrap this app as a client once per environment and put the result in `.env` (copy `.env.example`):

```bash
curl -X POST "http://localhost:8791/internal/oauth-clients/worker-client?redirect_uri=http://localhost:5173/auth-callback" \
    -H "Authorization: Bearer <worker-oidc's BETTER_AUTH_SECRET>"
```

No code here talks to `worker-realtime` yet — the two workers deploy independently with no service binding.

## Commands (run from this directory, or via `npm run <script> -w @capstone/client` from root)

- `dev` — vite
- `build` — `tsc -b && vite build`
- `lint` — `biome check .`
- `preview` — `npm run build && vite preview`
- `deploy` — `npm run build && wrangler deploy` (static assets only)
- `cf-typegen` — `wrangler types` (regenerates `worker-configuration.d.ts`)
- `test` / `test:run` — plain Vitest (empty `vitest.config.mjs`); `test/pkce.test.ts` and `test/return-to.test.ts` (the `takeReturnTo` open-redirect guard).

## TypeScript config

`tsconfig.json` is a references-only shell pointing at:
- `tsconfig.app.json` — browser/React code under `src/`, plus `test/`
- `tsconfig.node.json` — Vite config

Both extend the shared bases in `@capstone/typescript/configs/` (see `packages/config-typescript/CLAUDE.md`), adding only `tsBuildInfoFile`/`include`/`types` locally.

Biome (repo root config) handles formatting and linting, including React-specific rules (hooks, refresh) via the `react` linter domain — there is no separate ESLint config.
