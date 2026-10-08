# @capstone/admin

The admin console. A static React 19 + TanStack Router SPA, deployed as its own Cloudflare Worker so admin code stays out of the client bundle.

- Signs in against `worker-oidc` (Authorization Code + PKCE).
- `/users` lets an admin invite, change roles, ban/unban and delete users through `worker-oidc`'s `/api/admin/*` REST API.

```sh
npm run dev
npm run build
npm run deploy
npm run test:run
```

See [CLAUDE.md](CLAUDE.md) for details.
