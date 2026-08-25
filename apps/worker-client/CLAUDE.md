# CLAUDE.md — worker-client

`@capstone/client` — the frontend. React 19 + TanStack Router SPA built with Vite, served by a Cloudflare Worker (via `@cloudflare/vite-plugin`) as static assets, with a thin passthrough worker at `worker/index.ts` for `/api/*`.

## Layout

- `src/main.tsx` — entry point.
- `src/components/app.tsx` — root component.
- `src/routes/` — file-based routes (`__root.tsx`, `index.tsx`, `room.tsx`). Add/edit files here to change routing.
- `src/routeTree.gen.ts` — **generated** by the TanStack Router Vite plugin (`autoCodeSplitting: true`) from `src/routes/`. Don't hand-edit; let the dev server regenerate it.
- `worker/index.ts` — passthrough Cloudflare Worker handling `/api/*`; everything else is served as static assets.
- `worker-configuration.d.ts` — **generated** by `wrangler types` (`cf-typegen` script). ~14,900 lines; don't Read it in full (blocked via `.claude/settings.json` deny rule) — `grep` for the specific type/binding you need instead.

No code here talks to `worker-realtime` yet — the two workers deploy independently with no service binding.

## Commands (run from this directory, or via `npm run <script> -w @capstone/client` from root)

- `dev` — vite
- `build` — `tsc -b && vite build`
- `lint` — eslint
- `preview` — `npm run build && vite preview`
- `deploy` — `npm run build && wrangler deploy`
- `cf-typegen` — `wrangler types` (regenerates `worker-configuration.d.ts`)

## TypeScript config

`tsconfig.json` is a references-only shell pointing at:
- `tsconfig.app.json` — browser/React code under `src/`
- `tsconfig.node.json` — Vite config
- `tsconfig.worker.json` — the passthrough worker under `worker/`; extends `tsconfig.node.json` and types against `worker-configuration.d.ts`

ESLint (React-specific rules: hooks, refresh) is scoped to this app via its own `eslint.config.js`; Biome (repo root config) handles general formatting/linting.
