# Admin User Roles Dashboard Design

## Context

The worker-admin design (`docs/superpowers/specs/2026-09-12-worker-admin-design.md`) shipped `worker-admin` as a bare passthrough proxy with two explicit non-goals: "custom roles/permissions beyond `user`/`admin`" (the role check stayed a boolean) and "admin UI/frontend" (API only, no browser UI, no consumer for it yet). `apps/worker-admin/src` has since been scaffolded with a React 19 + TanStack Router SPA (`feat(admin): scaffold Vite + React frontend`), but it's a placeholder — one route rendering `<h3>Admin</h3>`, no components, no data fetching, no session handling.

This spec picks up both deferred items together: a real three-tier role model (`admin` > `manager` > `user`) with actual permission differences enforced server-side, and the dashboard UI that lets an admin or manager assign roles and manage users. It also becomes the first real consumer of `worker-auth`'s `oauthProvider` plugin, which has existed since the original auth worker design (`docs/superpowers/specs/2026-08-26-auth-worker-design.md`) specifically for "future applications to link in as OAuth clients" but has never had one until now.

## Goals

- Three roles — `admin`, `manager`, `user` — with `admin` holding the most privilege, enforced via Better Auth's access-control mechanism rather than the current boolean admin/not-admin check.
- `manager` can perform the same user-management actions as `admin` (list, edit role, ban/unban, remove) except: it cannot grant the `admin` role to anyone, and it cannot act on a user who currently holds the `admin` role.
- A working dashboard in `worker-admin`'s SPA: sign in, see a user list, change a user's role, ban/unban, remove — gated to what the signed-in viewer's own role permits.
- `worker-admin` signs in against `worker-auth` directly as an OAuth client (via the existing `oauthProvider` plugin), independent of `worker-client` — `worker-auth` remains the single source of truth for identity and role data, `worker-admin` still holds no database of its own.
- `worker-auth`'s `consentPage` (`/consent`) gets a real implementation for the first time, since this is genuinely the first linked application.

## Non-goals (explicitly deferred)

- **Per-classroom or resource-level permissions.** The three roles are global, not scoped to a classroom/resource. No `createAccessControl` statements beyond user-management actions.
- **Audit logging of admin/manager actions.** Not built in this pass; relies on Workers' own observability, same as the prior admin design's deferral.
- **Pagination/search in the user list.** A flat list is enough for the current user count; add when it stops being enough.
- **Dynamic/self-service OAuth client registration, or a general "link a new application" UI.** `worker-admin`'s OAuth client is registered once, out of band (a one-time script/manual call to `auth.api.createOAuthClient`), not through a UI other apps could use later.
- **Rate limiting beyond Better Auth's defaults.**
- **Any `worker-client` involvement beyond serving the consent page.** Its existing `/login` route is reused as-is. The one unavoidable exception is `/consent` (see Architecture) — since `baseURL` is pinned to `worker-client`'s origin, that's the only place `worker-auth`'s `consentPage` config can resolve to, so `worker-client` gains exactly one new route for it. No round-trip, no shared bearer-token code, no changes to `worker-client`'s own sign-in flow.

## Architecture

### Role & access control (`worker-auth`)

Replace the `admin` plugin's default boolean role check with a custom access-control definition (Better Auth's `createAccessControl` / `ac.newRole`, from `better-auth/plugins/access`):

- **`statement`**: the user-management actions the `admin` plugin already exposes (`list`, `create`, `update` (role), `ban`, `unban`, `impersonate`, `delete`) plus Better Auth's default statements.
- **`admin` role**: full statement set, including granting the `admin` role to others.
- **`manager` role**: the same statement set *except* it cannot include `admin` as a settable value on the `update`/set-role statement.
- **`user` role**: no statements — every `/api/auth/admin/*` call 403s, same as today for non-admins.
- **`admin({ ac, roles: { admin, manager, user } })`** replaces the current bare `admin({ adminUserIds })` config; `adminUserIds` (the bootstrap mechanism) is unchanged and still grants full `admin` power regardless of the `role` column.

Better Auth's statement/permission model checks what the *actor's* role can do, not what the *target's* current role is — it has no built-in way to express "manager cannot act on an admin". That half needs one small addition: a `before` hook (Better Auth supports per-endpoint hooks) on the `set-role`, `ban-user`, `unban-user`, and `remove-user` admin-plugin operations that, when the acting session's role is `manager`, loads the target user and rejects (403) if the target's current `role` is `admin`. This is the one piece of custom logic in the whole role model; everything else is `ac`/`statement` configuration.

`user.role` stays a plain `text` column (SQLite has no enum) with `defaultValue: 'user'`. Since `set-role` now accepts three values instead of two, validate the incoming value against the three known roles at that call site (the `admin` plugin's own input validation, or a thin Zod check if it doesn't already reject unknown values — confirm against the plugin's behavior at implementation time).

### `worker-admin` as an OAuth client of `worker-auth`

`worker-admin` registers once as an OAuth client of `worker-auth` (`auth.api.createOAuthClient`, called out-of-band with an authenticated admin session — a one-time setup step, not app code) and gets a `client_id`/`client_secret` plus a declared redirect URI (`<worker-admin-origin>/auth-callback`). The secret is stored as a `wrangler secret` on `worker-admin` (`OAUTH_CLIENT_SECRET` or similar) — it must never reach the browser.

Sign-in flow:

1. `worker-admin`'s `/login` route renders a "Sign in" button that navigates the browser to `worker-auth`'s `/api/auth/oauth2/authorize?client_id=...&redirect_uri=<worker-admin-origin>/auth-callback&...` (standard OAuth 2.1 authorization-code request), proxied there the same way `/api/auth/*` already is today.
2. If the browser has no `worker-auth` session yet, `worker-auth` redirects to its configured `loginPage` (`/login`, still `worker-client`'s existing page — unchanged, reused as-is since `baseURL` already points there) to sign in with Google.
3. `worker-auth` then redirects to its configured `consentPage` (`/consent`) — **new**, needs an actual page for the first time, implemented as a new route in `worker-client`'s SPA (the only place it can be served, since `consentPage` resolves against `baseURL`, which is `worker-client`'s origin — the same reason `loginPage` already lives there). Approving redirects back to the authorize endpoint, which issues an authorization code and redirects to `worker-admin`'s declared redirect URI.
4. `worker-admin`'s own backend (`worker/index.ts`, currently a blind `/api/auth/*` passthrough with no other logic) gains one real route: `GET /auth-callback`, which receives the `code`, exchanges it server-to-server for a token via `worker-auth`'s `/api/auth/oauth2/token` (using the stored `client_secret`), and returns the resulting bearer token to the SPA (e.g. as part of the callback page's response, for the SPA to pick up and store — exact hand-off mechanism, e.g. an inline script vs. a redirect with the token in a URL fragment, is an implementation-time detail — the constraint is that the `client_secret` itself never leaves the worker).
5. The SPA stores the bearer token (`sessionStorage`) and attaches it as `Authorization: Bearer <token>` on every subsequent `/api/auth/admin/*` call.

No code in `worker-client` changes. `worker-admin`'s existing `/api/auth/*` passthrough (`AUTH_SERVICE` binding) is untouched for everything except the new `/auth-callback` route.

### Dashboard UI (`worker-admin` SPA)

- **Routes** (`src/routes/`, TanStack Router file-based): `/login` (sign-in button), `/` (the dashboard — user table), root layout gains a `beforeLoad` auth guard.
- **Auth guard:** no stored token → redirect to `/login`. Token present but the resolved session's role is `user` → render an "access denied" message instead of the table. This is UX only — the real enforcement is server-side (the access-control model above), so a stale/forged client state can't grant anything the server wouldn't already allow.
- **API client:** Better Auth's `adminClient()` React client plugin (`createAuthClient({ plugins: [adminClient()] })`) rather than hand-rolled fetches — it already provides `authClient.admin.listUsers()` / `.setRole()` / `.banUser()` / `.unbanUser()` / `.removeUser()` and handles attaching the bearer token.
- **User table:** email, role badge, a role `<select>` constrained to the values the *viewer's own role* may grant (`manager` never sees `admin` as an option), ban/unban and remove buttons. Rows where the target's current role is `admin` render every control disabled when the viewer is a `manager` (mirrors the server-side `before`-hook restriction — belt-and-suspenders, not the actual security boundary).
- No pagination, search, or audit trail (see Non-goals).

## Data model

No new tables. `user.role` (existing `text` column, default `'user'`) now takes three meaningful values instead of two; no schema change, only a widened set of valid application-level values and the new `ac`/`statement` configuration described above. Re-run `npx auth@1.7.1 generate` after changing the `admin` plugin config and diff `schema.ts` before assuming no migration is needed (per `apps/worker-auth/CLAUDE.md`'s existing warning) — the OAuth-client registration for `worker-admin` also lands rows in the `oauthProvider` plugin's existing client-application tables, no new tables needed there either.

## Testing / verification

- **`worker-auth`:** extend `test/admin.test.ts` with the three-role matrix:
  1. `manager` can list users, change a non-admin user's role to `manager` or `user`, ban/unban a non-admin, remove a non-admin.
  2. `manager` gets 403 attempting to set anyone's role to `admin`.
  3. `manager` gets 403 attempting `set-role`/`ban`/`unban`/`remove` against a user whose current role is `admin`.
  4. `user` gets 403 on every `/api/auth/admin/*` endpoint (unchanged from today).
  5. `admin` (via `ADMIN_USER_IDS` bootstrap or a promoted account) retains full access, including granting `admin` and acting on other admins.
- **`worker-admin`:** the new `/auth-callback` route is the first real logic this worker has ever had — a focused Vitest test mocking `worker-auth`'s token endpoint (via the existing `AUTH_SERVICE` binding mock pattern) confirms the code-for-token exchange happens server-side and the client secret is never echoed back to the caller.
- **`worker-client`'s new `/consent` route:** the smallest test/manual-check that approving consent there actually completes the authorize round-trip back to `worker-admin`.
- **Manual browser check:** the full sign-in → consent → dashboard → role-change flow, once, in a real browser against local `wrangler dev` instances of both workers — this is the first time an OAuth-client round trip between two of this repo's own workers has ever run end-to-end, so it's worth the one manual pass beyond automated coverage.
- No frontend test runner exists in this repo yet; the dashboard UI itself is verified by the manual browser check above, not automated component tests.

## Versioning

Run `npm run changeset` and select `@capstone/admin` (new UI, new backend logic), `@capstone/auth` (access-control model change, new OAuth client), and `@capstone/client` (new `/consent` route) in the same run, per this repo's rule that a shared/upstream change materially affecting a consumer gets both bumped together.
