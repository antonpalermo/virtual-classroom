# @capstone/realtime

The realtime signaling backend. A Cloudflare Worker exposing a SQLite-backed `Messenger` Durable Object that upgrades `/messenger?room=<id>` requests to WebSockets. One Durable Object instance = one classroom, keyed by room id.

```sh
npm run dev
npm run typegen
npm run deploy
```

See [CLAUDE.md](CLAUDE.md) for details.
