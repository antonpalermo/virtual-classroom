# @capstone/openid-connect

The identity provider for the monorepo. A Cloudflare Worker (Better Auth + Drizzle on D1) that handles email/password and Google sign-in and acts as an OpenID Connect provider via Better Auth's `oauthProvider` plugin.

- `worker-client` and `worker-admin` sign in against it as public PKCE clients.
- Serves `/.well-known/openid-configuration`, the `/api/auth/oauth2/*` endpoints and the JWKS.
- Owns the login, consent and invite-acceptance pages (React SPA) and the admin user-management API (`/api/admin/*`).
- No self-service sign-up: admins invite users.

```sh
npm run dev
npm run migrations:auth   # generate auth DB migrations
npm run deploy
npm run test:run
```

See [CLAUDE.md](CLAUDE.md) for the routing split, role model and bootstrap steps.
