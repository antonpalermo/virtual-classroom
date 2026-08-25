# CLAUDE.md — worker-realtime

`@capstone/realtime` — the realtime signaling backend. A Cloudflare Worker exposing a `Messenger` Durable Object (SQLite-backed) that upgrades `/messenger?room=<id>` requests to WebSockets. One DO instance = one room, keyed by `env.MESSENGER.idFromName(room)`.

## Layout

- `src/index.ts` — the whole worker: `Messenger` DO class plus the fetch handler that does the WebSocket upgrade.
- `wrangler.jsonc` — defines the `Messenger` DO binding and its SQLite migration (`new_sqlite_classes`). When adding a new DO class or renaming one, add a corresponding entry to `migrations` rather than editing the existing tag.
- `worker-configuration.d.ts` — **generated** by `wrangler types` (`typegen` script). ~15,200 lines; don't Read it in full (blocked via `.claude/settings.json` deny rule) — `grep` for the specific type/binding you need instead.

## Hibernation API

Uses the DO hibernation API so idle rooms don't keep the DO warm:
- `ctx.acceptWebSocket` to accept a connection
- `webSocketMessage` / `webSocketClose` / `webSocketError` handlers instead of in-memory event listeners
- `setWebSocketAutoResponse` for ping/pong, so the DO doesn't wake for keepalives

No code here talks to `worker-client` yet — the two workers deploy independently with no service binding.

## Commands (run from this directory, or via `npm run <script> -w @capstone/realtime` from root)

- `dev` / `start` — `wrangler dev`
- `deploy` — `wrangler deploy`
- `typegen` — `wrangler types` (regenerates `worker-configuration.d.ts`)

Depends on `@capstone/standards` for HTTP status constants (see `packages/web-standards/CLAUDE.md`).
