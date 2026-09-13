# CLAUDE.md — config-typescript

`@capstone/typescript` — shared base `tsconfig` files, extended by the apps/packages in this monorepo. No source code, no build step.

## Layout

- `configs/tsconfig.lib.json` — base for plain library code (e.g. `packages/web-standards`).
- `configs/tsconfig.worker.json` — base for Cloudflare Workers runtime code bundled directly by `wrangler` (e.g. `apps/worker-realtime`, `apps/worker-auth`).
- `configs/tsconfig.app.json` — base for browser/React app code built with Vite (e.g. `apps/worker-client/tsconfig.app.json`, `apps/worker-admin/tsconfig.app.json`).
- `configs/tsconfig.node.json` — base for Vite's own Node-side config and for the thin passthrough Worker that Vite's `@cloudflare/vite-plugin` bundles alongside the frontend (e.g. `apps/worker-client/tsconfig.node.json` + `tsconfig.worker.json`, `apps/worker-admin/tsconfig.node.json` + `tsconfig.worker.json`) — deliberately not on the stricter `tsconfig.worker.json` base, since that Worker code lives in the same bundler pipeline as the frontend rather than wrangler's own bundler.

When adding TS config to a new package, extend one of these rather than writing compiler options from scratch. Each base holds shared `compilerOptions` only — the consuming `tsconfig.json` adds its own `include`/`exclude` and a workspace-scoped `tsBuildInfoFile` (e.g. `../../node_modules/.tmp/<workspace>/tsconfig.<name>.tsbuildinfo` — scope it per workspace, since the path is otherwise identical across workspaces at the same directory depth and would collide).
