# CLAUDE.md — worker-client

`@capstone/client` — the frontend. React 19 + TanStack Router SPA built with Vite, served by a Cloudflare Worker (via `@cloudflare/vite-plugin`) as static assets, with a thin passthrough worker at `worker/index.ts` proxying `/api/auth/*` to `worker-auth`.

## Layout

- `src/main.tsx` — entry point.
- `src/components/app.tsx` — root component.
- `src/routes/` — file-based routes (`__root.tsx`, `index.tsx`, `room.tsx`, `login.tsx`, `auth-callback.tsx`). Add/edit files here to change routing.
- `src/lib/session.ts` — `sessionStorage` accessors for the two stored credentials from a hosted-login round trip: `getStoredToken`/`storeSession`/`clearStoredSession` for the signed access token (JWT) and the bearer session token together (`storeSession({ token, session })`), plus `getStoredSession` to read the bearer token back out for sign-out.
- `src/routeTree.gen.ts` — **generated** by the TanStack Router Vite plugin (`autoCodeSplitting: true`) from `src/routes/`. Don't hand-edit; let the dev server regenerate it.
- `worker/index.ts` — bare passthrough Cloudflare Worker; forwards any `/api/auth/*` request to `worker-auth` via the `AUTH_SERVICE` service binding, 404s everything else under `/api/`. No special-case header/redirect rewriting — see the sign-in flow below.
- `worker-configuration.d.ts` — **generated** by `wrangler types` (`cf-typegen` script). ~14,900 lines; don't Read it in full (blocked via `.claude/settings.json` deny rule) — `grep` for the specific type/binding you need instead.

## Sign-in flow

`src/routes/login.tsx` links straight to worker-auth's own hosted `/login` (at `import.meta.env.VITE_AUTH_ORIGIN`, falling back to `http://localhost:8789` for local dev) with `?returnTo=<this origin>/auth-callback`. worker-auth hosts `/login` and `/login/complete` itself — see `apps/worker-auth/CLAUDE.md`. On success it redirects back to `/auth-callback` with `#token=<jwt>&session=<bearer session token>` on the URL fragment; `src/routes/auth-callback.tsx` reads both off the fragment and stores them via `src/lib/session.ts`, then redirects to `/`. The home route (`src/routes/index.tsx`) verifies the stored JWT locally via `verifyAccessToken` (`@capstone/auth-verify`) against worker-auth's JWKS endpoint. Signing out POSTs to worker-auth's `/api/auth/sign-out` with the stored bearer token before clearing local storage, so the session is actually revoked server-side rather than just forgotten locally.

`/api/auth/*` is proxied to `worker-auth` via the `AUTH_SERVICE` service binding (see `worker/index.ts`); no code here talks to `worker-realtime` yet — the two workers deploy independently with no service binding.

## Commands (run from this directory, or via `npm run <script> -w @capstone/client` from root)

- `dev` — vite
- `build` — `tsc -b && vite build`
- `lint` — `biome check .`
- `preview` — `npm run build && vite preview`
- `deploy` — `npm run build && wrangler deploy`
- `cf-typegen` — `wrangler types` (regenerates `worker-configuration.d.ts`)

## TypeScript config

`tsconfig.json` is a references-only shell pointing at:
- `tsconfig.app.json` — browser/React code under `src/`
- `tsconfig.node.json` — Vite config
- `tsconfig.worker.json` — the passthrough worker under `worker/`; types against `worker-configuration.d.ts`

All three extend the shared bases in `@capstone/typescript/configs/` (see `packages/config-typescript/CLAUDE.md`), adding only `tsBuildInfoFile`/`include`/`types` locally.

Biome (repo root config) handles formatting and linting, including React-specific rules (hooks, refresh) via the `react` linter domain — there is no separate ESLint config.
