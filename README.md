# Virtual Classroom

A virtual classroom / video conferencing app built entirely on Cloudflare Workers. A Turborepo monorepo (npm workspaces) of independently deployed Workers and shared packages.

## What's inside

### Apps

| Workspace              | Package                      | Domain                      | Local port | What it is                                                                                  |
| ---------------------- | ---------------------------- | --------------------------- | ---------- | ------------------------------------------------------------------------------------------- |
| `apps/worker-client`   | `@capstone/client`           | `dashboard.klassroom.online` | `5173`     | Frontend SPA (React 19 + TanStack Router). Signs in against `worker-oidc`.                  |
| `apps/worker-admin`    | `@capstone/admin`            | `admin.klassroom.online`     | `8790`     | Admin SPA: user management dashboard. Signs in against `worker-oidc`.                       |
| `apps/worker-oidc`     | `@capstone/openid-connect`   | `auth.klassroom.online`      | `8791`     | Identity provider: email/password + Google (D1 via Drizzle) and Better Auth's OIDC provider. |
| `apps/worker-realtime` | `@capstone/realtime`         | —                           | `8788`     | Realtime signaling (`Messenger` Durable Object).                                            |
| `apps/worker-auth`     | `@capstone/auth`             | —                           | `8789`     | Legacy identity worker (Google sign-in). No app signs in through it anymore.                |

`worker-client` and `worker-admin` are static SPAs; each signs in against `worker-oidc` as its own public OAuth client (Authorization Code + PKCE, straight from the browser, no service bindings).

### Packages

- `packages/lib-ui` (`@capstone/ui`) — shared shadcn/ui components + Tailwind v4 theme.
- `packages/lib-auth-verify` (`@capstone/auth-verify`) — verifies a `worker-oidc` JWT against its JWKS endpoint.
- `packages/lib-web-standards` (`@capstone/standards`) — generated HTTP status code/phrase constants.
- `packages/config-typescript` (`@capstone/typescript`) — shared base `tsconfig` files.

Each workspace has its own `CLAUDE.md` with implementation details.

## Getting started

```sh
npm install
npm run dev                                   # every app (persistent)
npx turbo run dev --filter=@capstone/openid-connect   # one app
```

Other root scripts (all Turborepo-backed unless noted):

```sh
npm run build          # build everything
npm run lint           # biome check per workspace
npm run check-types    # type-check per workspace
npm run test           # vitest, where a workspace has tests
npm run typegen        # wrangler types per worker
npm run format         # biome format --write (root only)
npm run changeset      # record a pending version bump (root only)
```

Formatting and linting are Biome only (no ESLint/Prettier); it also runs on staged files via Husky + lint-staged.

### Local setup for `worker-oidc`

```sh
cd apps/worker-oidc
cp .dev.vars.example .dev.vars   # fill in BETTER_AUTH_SECRET (32+ chars), Google + email vars
npm run migrations:auth          # apply D1 migrations locally
npm run dev                      # http://localhost:8791
```

## D1 migrations

`worker-oidc` stores everything in one D1 database (`worker-oidc`, binding `OIDC_DB`). The schema lives in `apps/worker-oidc/worker/db/schema.ts` (Drizzle); SQL migrations are generated into `apps/worker-oidc/drizzle/` and applied with Wrangler (`migrations_dir` is set in `wrangler.jsonc`).

Run these from `apps/worker-oidc`.

**1. Change the schema.** Edit `worker/db/schema.ts`. If the change comes from a Better Auth plugin/config change, regenerate and hand-merge instead of overwriting — a full regen drops the hand-added `user.role`/`banned`/… fields, the `invite` table and the `rateLimit` table:

```sh
npx auth@1.7.1 generate --config ./auth.cli.ts --adapter drizzle --dialect sqlite --output worker/db/schema.ts -y
git diff worker/db/schema.ts   # keep only the genuinely new pieces
```

**2. Generate the migration** and commit the new `drizzle/*.sql` (+ `drizzle/meta/`):

```sh
npx drizzle-kit generate
```

**3. Apply it.**

```sh
# local D1 (miniflare)
npm run migrations:auth

# production D1 — do this BEFORE deploying code that needs the new schema
npx wrangler d1 migrations apply worker-oidc --remote
```

Useful extras: `npx wrangler d1 migrations list worker-oidc --remote` shows what's pending. The Vitest suite applies the migrations to a throwaway test D1 automatically, so `npm run test:run` also validates them.

## Adding clients to OIDC

A client (an app that signs users in through `worker-oidc`) is registered once per environment through a bootstrap route, gated by `worker-oidc`'s `BETTER_AUTH_SECRET`. It creates (or, if it already exists, just looks up) a public, PKCE-required OAuth client and returns its `client_id`. It's idempotent, so re-running it is safe.

### Existing clients (`worker-client`, `worker-admin`)

```sh
# local
curl -X POST "http://localhost:8791/internal/oauth-clients/worker-client?redirect_uri=http://localhost:5173/auth-callback" \
    -H "Authorization: Bearer <worker-oidc BETTER_AUTH_SECRET>"

curl -X POST "http://localhost:8791/internal/oauth-clients/worker-admin?redirect_uri=http://localhost:8790/auth-callback" \
    -H "Authorization: Bearer <worker-oidc BETTER_AUTH_SECRET>"

# production
curl -X POST "https://auth.klassroom.online/internal/oauth-clients/worker-client?redirect_uri=https://dashboard.klassroom.online/auth-callback" \
    -H "Authorization: Bearer <production BETTER_AUTH_SECRET>"

curl -X POST "https://auth.klassroom.online/internal/oauth-clients/worker-admin?redirect_uri=https://admin.klassroom.online/auth-callback" \
    -H "Authorization: Bearer <production BETTER_AUTH_SECRET>"
```

Each returns `{"client_id": "..."}`. Put it in that app's env file as `VITE_OIDC_CLIENT_ID` (copy `.env.example` → `.env` locally; use `.env.production` for deploys), alongside `VITE_OIDC_ORIGIN` pointing at `worker-oidc` (defaults to `http://localhost:8791`). These are baked in at build time, so rebuild after changing them.

### A brand-new client

1. Add its name to `CLIENT_NAMES` in `apps/worker-oidc/worker/register-oauth-client.ts` (any other name 404s).
2. Run the `curl` above with the new name and its `redirect_uri` (use the app's real origin plus its callback path).
3. In the new app, implement Authorization Code + PKCE against `<oidc origin>/api/auth/oauth2/authorize` and `/api/auth/oauth2/token`, and verify tokens with `@capstone/auth-verify` — copy `apps/worker-client/src/lib/auth-client.ts`'s `redirectToSignIn` and `src/routes/auth-callback.tsx` as the reference.
4. Add the app's origin to CORS in `worker/index.ts` only if it calls `worker-oidc` cross-origin beyond `/jwks`, `/oauth2/userinfo` and `/oauth2/token` (already open).

Note: `worker-admin` additionally rejects non-admin accounts at authorize time (`worker/restrict-worker-admin-client.ts`); other clients are open to any signed-in user.

### The first admin account

There is no self-service sign-up. Seed the very first admin once per environment; after that, admins invite users from the `worker-admin` `/users` dashboard.

```sh
curl -X POST "https://auth.klassroom.online/internal/users/bootstrap-admin" \
    -H "Authorization: Bearer <production BETTER_AUTH_SECRET>" \
    -H "Content-Type: application/json" \
    -d '{"email":"<admin email>","password":"<admin password>","name":"Admin"}'
```

## Manual deployment

Deployment is manual for now (no CD pipeline). Prerequisites: `npx wrangler login` as an account that owns the `klassroom.online` zone, and a clean `dev`/`main` checkout of what you intend to ship.

Each app deploys independently. Order matters only for `worker-oidc`, which the SPAs depend on.

### 1. `worker-oidc` (first)

```sh
cd apps/worker-oidc

# one-time: secrets (prompted for the value)
npx wrangler secret put BETTER_AUTH_SECRET
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put EMAIL_PROVIDER_SECRET_KEY
# non-secret vars (BETTER_AUTH_URL, RESET_EMAIL_FROM, EMAIL_PROVIDER_ENDPOINT) must also be set for production — see .dev.vars.example

npx wrangler d1 migrations apply worker-oidc --remote   # schema first
npm run deploy                                          # build + wrangler deploy
```

Then bootstrap the clients and the first admin (see [Adding clients to OIDC](#adding-clients-to-oidc)). Google sign-in needs `https://auth.klassroom.online/api/auth/callback/google` as an authorized redirect URI in the Google Cloud OAuth client.

### 2. `worker-client` and `worker-admin`

Make sure `.env.production` holds the right `VITE_OIDC_ORIGIN` and `VITE_OIDC_CLIENT_ID` (from the bootstrap step), then:

```sh
cd apps/worker-client && npm run deploy   # build + wrangler deploy (static assets)
cd apps/worker-admin  && npm run deploy
```

### 3. `worker-realtime` / `worker-auth`

```sh
cd apps/worker-realtime && npm run deploy
cd apps/worker-auth     && npm run deploy   # legacy; only if you still need it
```

### Checklist

- [ ] `npm run lint && npm run check-types && npm run test` pass
- [ ] D1 migrations applied with `--remote` before the code that needs them
- [ ] Clients registered for the target `redirect_uri` and `VITE_OIDC_CLIENT_ID` matches
- [ ] Smoke test: sign in at `https://dashboard.klassroom.online` and `https://admin.klassroom.online`

## Branching and versioning

`main` is production-ready, `dev` is the integration branch; short-lived `feature/*`, `fix/*`, `chore/*` branches are squash-merged into `dev`, and `dev → main` is a regular merge. Every workspace is versioned independently with [Changesets](https://github.com/changesets/changesets): run `npm run changeset` on your branch and commit the generated file. See `CLAUDE.md` for the full workflow.
