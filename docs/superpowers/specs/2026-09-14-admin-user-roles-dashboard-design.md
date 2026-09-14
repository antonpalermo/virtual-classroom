# Admin User Roles Dashboard Design

## Context

The worker-admin design (`docs/superpowers/specs/2026-09-12-worker-admin-design.md`) shipped `worker-admin` as a bare passthrough proxy with two explicit non-goals: "custom roles/permissions beyond `user`/`admin`" (the role check stayed a boolean) and "admin UI/frontend" (API only, no browser UI, no consumer for it yet). `apps/worker-admin/src` has since been scaffolded with a React 19 + TanStack Router SPA (`feat(admin): scaffold Vite + React frontend`), but it's a placeholder — one route rendering `<h3>Admin</h3>`, no components, no data fetching, no session handling.

This spec picks up both deferred items together: a real three-tier role model (`admin` > `manager` > `user`) with actual permission differences enforced server-side, and the dashboard UI that lets an admin or manager assign roles and manage users.

An earlier draft of this spec explored making `worker-admin` a direct OAuth client of `worker-auth`'s `oauthProvider` plugin (which has existed since the original auth worker design specifically for "future applications to link in as OAuth clients"). That turned out not to work: the OAuth-provider's issued access token is a differently-formatted JWT, and `worker-auth`'s own `/api/auth/admin/*` endpoints only accept a session presented via the `bearer` plugin's specific HMAC-signed token format (verified against `node_modules/better-auth/dist/plugins/bearer/index.mjs`) — the two don't interoperate, so completing the full authorize/consent/token dance would still leave `worker-admin` without a usable credential. This spec instead uses the bearer-token round-trip mechanism the original worker-admin design already established and tested (`apps/worker-admin/CLAUDE.md`'s "Calling the API directly" section) — sign in on `worker-client`, obtain the session's bearer token, hand it to `worker-admin`.

## Goals

- Three roles — `admin`, `manager`, `user` — with `admin` holding the most privilege, enforced via Better Auth's access-control mechanism rather than the current boolean admin/not-admin check.
- `manager` can perform the same user-management actions as `admin` (list, edit role, ban/unban, remove) except: it cannot grant the `admin` role to anyone, and it cannot act on a user who currently holds the `admin` role.
- A working dashboard in `worker-admin`'s SPA: sign in, see a user list, change a user's role, ban/unban, remove — gated to what the signed-in viewer's own role permits.
- A real sign-in flow for `worker-admin` (today it's a manual curl-only workflow) — the browser round-trips through `worker-client`'s existing sign-in to obtain a bearer token, same mechanism already documented and tested, just automated instead of manual. `worker-auth` remains the single source of truth for identity and role data; `worker-admin` still holds no database of its own.

## Non-goals (explicitly deferred)

- **Per-classroom or resource-level permissions.** The three roles are global, not scoped to a classroom/resource. No `createAccessControl` statements beyond user-management actions.
- **Audit logging of admin/manager actions.** Not built in this pass; relies on Workers' own observability, same as the prior admin design's deferral.
- **Pagination/search in the user list.** A flat list is enough for the current user count; add when it stops being enough.
- **`worker-auth`'s `oauthProvider` plugin.** Not used by this feature at all (see Context) — its config is untouched, and registering a real linked application through it remains a future follow-up.
- **Rate limiting beyond Better Auth's defaults.**
- **Persistent/long-lived `worker-admin` sessions.** The bearer token lives in `sessionStorage` (cleared when the tab closes) — no refresh-token handling, no "remember me". Signing in again just repeats the round-trip.

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

### Sign-in round-trip (`worker-client` → `worker-admin`)

A bearer token derived from a `worker-auth` session is origin-agnostic (the `bearer` plugin resolves it the same way no matter which worker's `/api/auth/*` passthrough forwards the request) — it's the thing that crosses from `worker-client` to `worker-admin`, carried in a URL fragment (never sent to a server, since fragments aren't part of an HTTP request).

Getting that token in the first place is less direct than it sounds. Checked against Better Auth's actual session-refresh logic (`node_modules/better-auth/dist/api/routes/session.mjs`): the `bearer` plugin only emits `set-auth-token` on a response that itself reissues the session-*token* cookie (sign-in, or a session old enough to need its rolling refresh) — never on an ordinary `get-session` call against an already-fresh session, which is exactly what a just-completed sign-in produces (confirmed by a comment already in `worker-auth`'s own `test/admin.test.ts`, from when this was verified for that test). And the one response that *does* carry it — the Google OAuth callback (`/api/auth/callback/google`) — is, in a real browser, a top-level redirect: the SPA's JS never runs against that exact response, so it can't read the header off it directly the way the test (which drives the callback with a raw `fetch()`, not a browser navigation) does.

So the token has to be captured server-side, where header access isn't restricted by the browser's navigation model. `worker-client`'s passthrough Worker (`worker/index.ts`, currently a blind proxy) already sees the callback response pass through on its way back to the browser — it gains one conditional: when that response is `/api/auth/callback/google`'s redirect, carries `set-auth-token`, and its `Location` target has a `returnTo` param (scoping this to the admin round-trip only, leaving every other sign-in untouched), rewrite the `Location` header to append `#token=<the token>` as a fragment. Browsers honor a fragment on a redirect's `Location` header (this is exactly how OAuth's old implicit-grant flow worked), so the browser lands on the fragment-bearing URL with no extra JS needed for this leg.

1. `worker-admin`'s `/login` route renders a "Sign in" button linking to `worker-client`'s `/login?returnTo=<worker-admin-origin>/auth-callback`.
2. `worker-client`'s `/login` route (`apps/worker-client/src/routes/login.tsx`) gains a `returnTo` search param. Before ever acting on it, it validates `returnTo` against a small allowlist of known origins (starts with `worker-admin`'s dev/prod origin) — a bearer token is a live credential, so forwarding it to an arbitrary attacker-supplied redirect target would be an open-redirect-to-token-leak. The "Sign in with Google" button's `callbackURL` is set to `/login?returnTo=<same value>` so the flow lands back here post-Google-auth, and always goes through the button (even if already signed in elsewhere) since a fresh sign-in is the only reliable way to get a fresh token.
3. `worker-client`'s passthrough rewrites the callback's `Location` header as described above, so the browser arrives back at `/login?returnTo=...#token=...`.
4. The `/login` route detects the `#token=` fragment (alongside a validated `returnTo`) and navigates to `${returnTo}#token=<the token>` — handing off to `worker-admin`.
5. `worker-admin`'s new `/auth-callback` SPA route (`apps/worker-admin/src/routes/auth-callback.tsx`) reads the token from `location.hash`, stores it in `sessionStorage`, and redirects to `/`.
6. The SPA attaches the stored token as `Authorization: Bearer <token>` on every `/api/auth/admin/*` call via the Better Auth client's global `fetchOptions.auth` (`{ type: 'Bearer', token: () => sessionStorage.getItem(...) }`).

`worker-admin`'s existing `/api/auth/*` passthrough (`AUTH_SERVICE` binding) is untouched — only `worker-client`'s passthrough gains logic.

### Dashboard UI (`worker-admin` SPA)

- **Routes** (`src/routes/`, TanStack Router file-based): `/login` (sign-in button), `/` (the dashboard — user table), root layout gains a `beforeLoad` auth guard.
- **Auth guard:** no stored token → redirect to `/login`. Token present but the resolved session's role is `user` → render an "access denied" message instead of the table. This is UX only — the real enforcement is server-side (the access-control model above), so a stale/forged client state can't grant anything the server wouldn't already allow.
- **API client:** Better Auth's `adminClient()` React client plugin (`createAuthClient({ plugins: [adminClient()] })`) rather than hand-rolled fetches — it already provides `authClient.admin.listUsers()` / `.setRole()` / `.banUser()` / `.unbanUser()` / `.removeUser()` and handles attaching the bearer token.
- **User table:** email, role badge, a role `<select>` constrained to the values the *viewer's own role* may grant (`manager` never sees `admin` as an option), ban/unban and remove buttons. Rows where the target's current role is `admin` render every control disabled when the viewer is a `manager` (mirrors the server-side `before`-hook restriction — belt-and-suspenders, not the actual security boundary).
- No pagination, search, or audit trail (see Non-goals).

## Data model

No new tables. `user.role` (existing `text` column, default `'user'`) now takes three meaningful values instead of two; no schema change, only a widened set of valid application-level values and the new `ac`/`statement` configuration described above. Re-run `npx auth@1.7.1 generate` after changing the `admin` plugin config and diff `schema.ts` before assuming no migration is needed (per `apps/worker-auth/CLAUDE.md`'s existing warning).

## Testing / verification

- **`worker-auth`:** extend `test/admin.test.ts` with the three-role matrix:
  1. `manager` can list users, change a non-admin user's role to `manager` or `user`, ban/unban a non-admin, remove a non-admin.
  2. `manager` gets 403 attempting to set anyone's role to `admin`.
  3. `manager` gets 403 attempting `set-role`/`ban`/`unban`/`remove` against a user whose current role is `admin`.
  4. `user` gets 403 on every `/api/auth/admin/*` endpoint (unchanged from today).
  5. `admin` (via `ADMIN_USER_IDS` bootstrap or a promoted account) retains full access, including granting `admin` and acting on other admins.
- **`worker-client`'s passthrough:** this worker has no test runner at all today (no `test` script, no Vitest config — unlike `worker-auth` and `worker-admin`, which both already use `@cloudflare/vitest-pool-workers`). The `Location`-header rewrite is real, security-relevant branch logic (it's what keeps a bearer token from leaking onto redirects that don't need it), so it earns `worker-client`'s first test file: a minimal Vitest setup mirroring `worker-admin`'s (`AUTH_SERVICE` mocked, no real `worker-auth` needed) asserting the rewrite fires only when `returnTo` is present on the callback's redirect target, and leaves every other response — including a `/api/auth/callback/google` redirect with no `returnTo` — untouched.
- **Manual browser check:** the full sign-in round-trip → dashboard → role-change flow, once, in a real browser against local dev servers for both `worker-client` and `worker-admin` — this is the first time the bearer-token hand-off has been automated end-to-end (rather than a developer copy-pasting a token via curl), and the `returnTo` allowlist check on the client side is exactly the kind of thing worth eyeballing in a real browser once.
- No frontend *component* test runner exists in this repo (or is being added); the dashboard UI and the `/login` route's own rendering are verified by the manual browser check above, not automated component tests.

## Versioning

Run `npm run changeset` and select `@capstone/admin` (new UI, new sign-in flow), `@capstone/auth` (access-control model change), and `@capstone/client` (new `returnTo` round-trip logic on `/login`) in the same run, per this repo's rule that a shared/upstream change materially affecting a consumer gets both bumped together.
