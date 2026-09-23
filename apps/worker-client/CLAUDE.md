# CLAUDE.md — worker-client

`@capstone/client` — the frontend. React 19 + TanStack Router SPA built with Vite, served as static assets via `@cloudflare/vite-plugin` in dev and the `assets` config in `wrangler.jsonc` when deployed. There is no backend Worker — no `worker/` directory, no service bindings — it's a fully static SPA, same shape as `apps/worker-admin`.

## Layout

- `src/main.tsx` — entry point.
- `src/components/app.tsx` — root component.
- `src/routes/` — file-based routes (`__root.tsx`, `index.tsx`, `room.tsx`, `login.tsx`, `auth-callback.tsx`). Add/edit files here to change routing.
- `src/lib/pkce.ts` — `createPkcePair()`, a copy of `apps/worker-admin`'s (random `code_verifier` + S256 `code_challenge`, base64url, via Web Crypto). `test/pkce.test.ts` covers it.
- `src/lib/auth-client.ts` — `sessionStorage` accessors for the one stored credential, the `id_token`: `getStoredJwt`/`storeJwt`/`clearStoredJwt`, keyed as `client_jwt`.
- `src/routeTree.gen.ts` — **generated** by the TanStack Router Vite plugin (`autoCodeSplitting: true`) from `src/routes/`. Don't hand-edit; let the dev server regenerate it.
- `worker-configuration.d.ts` — **generated** by `wrangler types` (`cf-typegen` script). Don't Read it in full (blocked via `.claude/settings.json` deny rule) — `grep` for the specific type you need instead. Nothing under `src/` imports from it today.

## Sign-in flow

Authorization Code + PKCE against `apps/worker-oidc`, identical to `apps/worker-admin`'s (see `apps/worker-admin/CLAUDE.md` for the step-by-step): `src/routes/login.tsx` stashes a PKCE verifier + `state` in `sessionStorage` and redirects to worker-oidc's `/api/auth/oauth2/authorize`; worker-oidc hosts `/login` and `/consent`; `src/routes/auth-callback.tsx` checks `state`, exchanges the `code` at `/api/auth/oauth2/token` directly from the browser, and stores the returned `id_token`. The home route (`src/routes/index.tsx`) is public — it verifies any stored token locally via `verifyAccessToken` (`@capstone/auth-verify`) against worker-oidc's `/api/auth/jwks` and shows either "Signed in as …" or a sign-in link. Signing out only clears the stored token; the worker-oidc session cookie survives, so the next sign-in may skip the login page.

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
- `test` / `test:run` — plain Vitest (empty `vitest.config.mjs`); only `test/pkce.test.ts` today.

## TypeScript config

`tsconfig.json` is a references-only shell pointing at:
- `tsconfig.app.json` — browser/React code under `src/`, plus `test/`
- `tsconfig.node.json` — Vite config

Both extend the shared bases in `@capstone/typescript/configs/` (see `packages/config-typescript/CLAUDE.md`), adding only `tsBuildInfoFile`/`include`/`types` locally.

Biome (repo root config) handles formatting and linting, including React-specific rules (hooks, refresh) via the `react` linter domain — there is no separate ESLint config.
