# Worker Admin Design

## Context

The auth worker design (`docs/superpowers/specs/2026-08-26-auth-worker-design.md`) deliberately deferred two things: the real roles/permissions model, and any admin UI/API for managing users. It shipped a placeholder `user.role` column (`'user'` default, `input: false`) and Better Auth's `oauthProvider` plugin so future applications could link in without touching `worker-auth`'s database directly.

This spec picks up that deferred work: a new, separately deployed Worker dedicated to admin tasks (user management, role assignment, and whatever else comes later), kept apart from `worker-client` so the client bundle/deploy stays unrelated to admin surface area.

## Goals

- A new Cloudflare Worker, `apps/worker-admin` (`@capstone/admin`), that exposes admin operations: list/search users, view a user, assign roles, ban/unban, remove a user.
- `worker-auth` remains the single source of truth for user data — `worker-admin` holds no database of its own and duplicates no user-record logic.
- A working bootstrap path for the very first admin account, since role assignment itself requires an existing admin.
- API only for this pass; no browser UI.

## Non-goals (explicitly deferred)

- **Admin UI / frontend.** `worker-admin` is a JSON API in this pass. A UI is a separate follow-up once there's a real consumer for it.
- **Custom roles/permissions beyond `user`/`admin`.** No `createAccessControl`/custom `ac`, no per-classroom instructor role, no resource-level permission matrix. The role check stays a boolean (`admin` or not).
- **Custom domain / cross-subdomain cookies.** No custom domain is configured anywhere in this repo yet (per the auth worker design's own deferral). `worker-admin` is reached directly (its own `workers.dev` URL / dev port), not via a shared parent domain.
- **Audit logging of admin actions.** Not built in this pass; `admin` plugin operations are not separately logged beyond Workers' own observability.
- **Rate limiting beyond Better Auth's defaults.**

## Architecture

`apps/worker-admin`, structured like `apps/worker-client`'s passthrough worker (no frontend build step at all here, though — this is a bare Worker, not a Vite/assets app):

- **No database, no Better Auth instance of its own.** All user/role data and all authorization logic lives in `worker-auth`. `worker-admin` is a thin Hono proxy.
- **Routing:** `src/index.ts` forwards any `/api/auth/*` request to `AUTH_SERVICE` (a service binding to `worker-auth`, same binding name convention `worker-client` already uses) and 404s everything else — a byte-for-byte copy of `apps/worker-client/worker/index.ts`'s bare `ExportedHandler` (no Hono, no `@capstone/standards` — that passthrough doesn't use either, so neither does this one). Because Better Auth's `admin` plugin mounts its routes under the auth instance's own basePath (`/api/auth/admin/*`), this single passthrough already exposes every admin operation; no separate `/api/admin/*` route layer or role-check middleware is needed in `worker-admin` itself. `worker-auth`'s `admin` plugin is the one place that authorizes — duplicating that check here would just be two checks that can drift out of sync.
- **Service binding:** `services: [{ binding: "AUTH_SERVICE", service: "worker-auth" }]` in `wrangler.jsonc`, matching `worker-client`'s config shape.
- **Dev port:** `8790` / inspector `9232` — the next free pair given `worker-realtime` (`8788`/`9231`), `worker-auth` (`8789`/`9230`), and `worker-client`'s Vite defaults (`5173`/`9229`) — following the same collision-avoidance comment pattern already in `worker-auth/wrangler.jsonc`.

### Changes to `worker-auth`

- **Add the `admin` plugin** (`better-auth/plugins/admin`) to `auth.ts`:
  - `adminRoles` is left unset — its default (`['admin']`) already matches the existing placeholder `role` field's intended values, confirmed against `node_modules/better-auth/dist/plugins/admin/admin.mjs`.
  - `adminUserIds` sourced from a new `ADMIN_USER_IDS` env var/secret (comma-separated Better Auth user IDs, parsed once per `createAuth` call): `env.ADMIN_USER_IDS?.split(',').filter(Boolean) ?? []`. This is Better Auth's own built-in mechanism for granting admin power to specific accounts regardless of their `role` column value — the bootstrap path for the first admin(s), with no manual D1 writes and no custom hook code.
  - Once at least one bootstrap admin exists, they can promote other accounts to `role: 'admin'` via the plugin's `setRole` operation; `ADMIN_USER_IDS` only needs to carry however many accounts are needed to get started.
- **Add the `bearer` plugin** (`better-auth/plugins/bearer`) — lets a session be presented via an `Authorization: Bearer <token>` header instead of a cookie. See "Cross-origin session" below for why this is needed.
- **Add `worker-admin`'s origin(s)** (dev port URL today; production URL once one exists) to `trustedOrigins`.

### Cross-origin session: why `bearer`, not cookies

Google's OAuth `redirect_uri` is pinned to a single `BETTER_AUTH_URL` (`worker-client`'s origin, per the existing auth worker design). Sign-in always completes there, so the resulting session cookie is host-scoped to `worker-client`'s origin — it is never sent to `worker-admin`'s separate origin by the browser, and there is no shared parent domain (`crossSubDomainCookies`) to make that work, since no custom domain exists yet (see Non-goals).

Since `worker-admin` has no browser UI in this pass, there is no login-page redirect to make work at all. Instead: an admin signs in through `worker-client` as they already do today, obtains their session's bearer token (the `bearer` plugin returns one; see Better Auth's docs for the exact response field), and calls `worker-admin` directly with that token in the `Authorization` header. `worker-admin`'s proxy forwards the header verbatim; `bearer` resolves it to the same session on `worker-auth`'s side, origin-agnostic, with no bridging code. Example:

```
curl -H "Authorization: Bearer <token>" http://localhost:<worker-admin-port>/api/auth/admin/list-users
```

## Data model

No new tables beyond what the auth worker design already established. The `admin` plugin uses the existing `user.role` column; it adds no new schema of its own (it's a behavior/authorization plugin, not a data plugin) beyond what `npx auth@latest generate` picks up when re-run after adding it — re-run and diff before assuming no migration is needed.

## Scaffolding

Follows the existing per-workspace conventions (see `apps/worker-realtime` as the closest analog — single-purpose Worker, no frontend build):

- `package.json`: `@capstone/admin`, `private: true`, `version: "0.0.0"` (bumped via Changesets once real work lands). No runtime dependencies at all — matching `worker-client`'s passthrough, a bare `ExportedHandler` needs neither Hono nor `@capstone/standards`. Dev dependencies: `@capstone/typescript`, `@cloudflare/workers-types`, `@cloudflare/vitest-pool-workers`, `vitest`, `wrangler`.
- `wrangler.jsonc`: `name: "worker-admin"`, `main: "src/index.ts"`, `services: [{ binding: "AUTH_SERVICE", service: "worker-auth" }]`, `observability.enabled: true`, `upload_source_maps: true`, own `dev.port`/`dev.inspector_port`. No `d1_databases`, no `assets` block.
- `tsconfig.json`: extends `@capstone/typescript`'s shared worker base directly (like `worker-realtime`'s, not a references-shell like `worker-client`'s — there's no separate browser bundle here).
- `worker-configuration.d.ts`: generated via the standard `typegen` script (`wrangler types`) once the binding exists; not hand-written.
- `apps/worker-admin/CLAUDE.md`: documents the layout, the "thin proxy, no auth logic of its own" shape, and the bearer-token calling convention above.
- Root `CLAUDE.md`: add `apps/worker-admin` to the monorepo map (one line, linking to its own `CLAUDE.md`), and update `apps/worker-auth/CLAUDE.md`'s existing "which workers consume `AUTH_SERVICE`" note to include it.

## Testing / verification

- **`worker-admin`:** one small Vitest file (`@cloudflare/vitest-pool-workers`, matching `worker-auth`'s existing setup) with the `AUTH_SERVICE` binding mocked, asserting: a request under `/api/auth/*` is forwarded to the binding and its response returned verbatim; a request outside that prefix 404s. This is the one branch of actual logic in the whole worker, so it gets the one check ponytail's rules call for — nothing more elaborate.
- **`worker-auth`:** extend the existing Vitest suite to cover the new plugin wiring end-to-end (not just "the plugin is configured"):
  1. A user whose ID is listed in `ADMIN_USER_IDS` can call `auth.api.listUsers` / hit `/api/auth/admin/list-users` and get a result.
  2. A signed-in user *not* in `ADMIN_USER_IDS` and with `role: 'user'` gets rejected calling the same endpoint.
  3. An admin's `setRole` call promotes another user to `role: 'admin'`, and that user can then call admin endpoints too (without being in `ADMIN_USER_IDS`) — proves the "bootstrap admin promotes further admins" path actually works.
  4. A session obtained via normal sign-in can be presented as `Authorization: Bearer <token>` (via the `bearer` plugin) and resolves to the same session/authorization as the cookie would.

## Versioning

`apps/worker-admin` is picked up by Changesets automatically (`.changeset/config.json` reads the root `workspaces` field — no config change needed). When this ships, run `npm run changeset` and select both `@capstone/admin` (new workspace) and `@capstone/auth` (plugin/env var changes to `auth.ts`) in the same run.
