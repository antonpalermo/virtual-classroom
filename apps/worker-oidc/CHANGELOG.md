# @capstone/openid-connect

## 0.2.0

### Minor Changes

- c361a77: Admin-only user-management CRUD for worker-admin, backed by a new `/api/admin/*` REST API in worker-oidc: list/create/edit-role/ban/unban/delete users, gated by a bearer JWT plus a fresh-from-D1 role check. Account creation goes through a one-time invite link (`/accept-invite`, `POST /api/invites/accept`) since there's still no self-service sign-up. Adds `role`/`banned`/`banReason`/`banExpires` to worker-oidc's `user` table and a new `invite` table; the id_token now carries a `role` claim (worker-admin uses it for UI gating only — the admin API re-checks role/ban status against D1 on every call). Banned users are rejected at sign-in via a `databaseHooks.session.create.before` hook, with an already-expired ban auto-lifted on the next sign-in attempt.

    `@capstone/auth-verify` gains `verifyAccessTokenWithJwks` (in-process verification against a locally-held JWKS, used by worker-oidc's own admin API to avoid a self-HTTP round trip) and fixes `verifyAccessToken`'s remote-JWKS path to not wait out jose's 30s cooldown when it encounters an unfamiliar signing key.

- ed5a785: worker-client now signs in against worker-oidc (Authorization Code + PKCE) and no longer has a backend Worker or `AUTH_SERVICE` binding; worker-oidc's client bootstrap route is now `/internal/oauth-clients/:name` and accepts `worker-client` alongside `worker-admin`.
- 30e9212: Remove self-service sign-up entirely (email/password and Google) and add a bootstrap route to seed accounts directly.
- 775572b: Add Google sign-in to the hosted login and signup pages.

### Patch Changes

- Updated dependencies [c361a77]
    - @capstone/auth-verify@0.2.0

## 0.1.0

### Minor Changes

- a206b05: worker-admin now signs in via PKCE authorization code flow against worker-oidc instead of worker-auth's Google sign-in and admin plugin, with the user-management dashboard deferred to a future release. worker-oidc gained real /login, /signup, and /consent pages plus a guarded bootstrap route to register OAuth clients. @capstone/auth-verify's role claim is now optional since worker-oidc tokens do not carry role data.
- 347196d: worker-oidc's login, signup, and consent pages are now a Vite + React + TanStack Router SPA instead of hand-written HTML strings served by the Hono app. The Worker now only handles /api/auth/* and /internal/*; everything else is served as static assets. No behavior change to the OAuth/OIDC flow itself.
