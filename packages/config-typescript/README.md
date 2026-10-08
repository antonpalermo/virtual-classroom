# @capstone/typescript

Shared base `tsconfig` files for the monorepo. No source code, no build step.

- `configs/tsconfig.lib.json` — plain libraries
- `configs/tsconfig.worker.json` — Cloudflare Workers code bundled by wrangler
- `configs/tsconfig.app.json` — browser/React apps built with Vite

Extend them from a workspace's `tsconfig.json`, e.g. `"extends": "@capstone/typescript/configs/tsconfig.worker.json"`.
