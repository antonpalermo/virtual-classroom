# CLAUDE.md — config-typescript

`@capstone/typescript` — shared base `tsconfig` files, extended by the apps/packages in this monorepo. No source code, no build step.

## Layout

- `configs/tsconfig.lib.json` — base for plain library code (e.g. `packages/web-standards`).
- `configs/tsconfig.worker.json` — base for Cloudflare Workers runtime code (e.g. `apps/worker-realtime`, `apps/worker-auth`, and `worker-client/tsconfig.worker.json`).

When adding TS config to a new package, extend one of these rather than writing compiler options from scratch — `tsconfig.lib.json` for plain library code, `tsconfig.worker.json` for Workers runtime code.
