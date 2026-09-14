# CLAUDE.md — worker-client

`@capstone/client` — the frontend. React 19 + TanStack Router SPA built with Vite, served by a Cloudflare Worker (via `@cloudflare/vite-plugin`) as static assets, with a thin passthrough worker at `worker/index.ts` proxying `/api/auth/*` to `worker-auth`.

## Layout

- `src/main.tsx` — entry point.
- `src/components/app.tsx` — root component.
- `src/routes/` — file-based routes (`__root.tsx`, `index.tsx`, `room.tsx`, `login.tsx`). Add/edit files here to change routing.
- `src/lib/auth-client.ts` — the `better-auth/react` client (`authClient`), used by the `/login` route and the home page for sign-in, sign-out, and session state.
- `src/routeTree.gen.ts` — **generated** by the TanStack Router Vite plugin (`autoCodeSplitting: true`) from `src/routes/`. Don't hand-edit; let the dev server regenerate it.
- `worker/index.ts` — passthrough Cloudflare Worker; proxies `/api/auth/*` to `worker-auth` via the `AUTH_SERVICE` service binding, 404s everything else under `/api/`. Fetches through with `redirect: 'manual'` so an upstream 3xx reaches the browser as-is instead of being auto-followed. It also specifically rewrites the OAuth callback's (`/api/auth/callback/google`) redirect `Location` header to append a `#token=<bearer token>` fragment — but only when the redirect target's query string carries a `returnTo` param; every other redirect passes through unchanged. This is how `worker-admin`'s sign-in round-trip picks up a session here despite having no cookie of its own — see `src/routes/login.tsx` below and `docs/superpowers/specs/2026-09-14-admin-user-roles-dashboard-design.md`.
- `worker-configuration.d.ts` — **generated** by `wrangler types` (`cf-typegen` script). ~14,900 lines; don't Read it in full (blocked via `.claude/settings.json` deny rule) — `grep` for the specific type/binding you need instead.

`/api/auth/*` is proxied to `worker-auth` via the `AUTH_SERVICE` service binding (see `worker/index.ts`); `src/lib/auth-client.ts` holds the `better-auth/react` client the `/login` route and the home page use. No code here talks to `worker-realtime` yet — the two workers deploy independently with no service binding.

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
