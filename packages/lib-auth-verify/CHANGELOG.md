# @capstone/auth-verify

## 0.2.0

### Minor Changes

- c361a77: Admin-only user-management CRUD for worker-admin, backed by a new `/api/admin/*` REST API in worker-oidc: list/create/edit-role/ban/unban/delete users, gated by a bearer JWT plus a fresh-from-D1 role check. Account creation goes through a one-time invite link (`/accept-invite`, `POST /api/invites/accept`) since there's still no self-service sign-up. Adds `role`/`banned`/`banReason`/`banExpires` to worker-oidc's `user` table and a new `invite` table; the id_token now carries a `role` claim (worker-admin uses it for UI gating only — the admin API re-checks role/ban status against D1 on every call). Banned users are rejected at sign-in via a `databaseHooks.session.create.before` hook, with an already-expired ban auto-lifted on the next sign-in attempt.

    `@capstone/auth-verify` gains `verifyAccessTokenWithJwks` (in-process verification against a locally-held JWKS, used by worker-oidc's own admin API to avoid a self-HTTP round trip) and fixes `verifyAccessToken`'s remote-JWKS path to not wait out jose's 30s cooldown when it encounters an unfamiliar signing key.

## 0.1.0

### Minor Changes

- 03e87c9: worker-auth now hosts its own login page and issues a signed JWT after sign-in, so worker-client and worker-admin redirect there directly and verify sessions locally instead of relaying an opaque bearer token through worker-client's login page. Adds the new `@capstone/auth-verify` package for local JWT verification against worker-auth's JWKS. worker-admin's admin-plugin API calls (setRole/ban/unban/remove) keep using the existing bearer session token, unchanged.

### Patch Changes

- a206b05: worker-admin now signs in via PKCE authorization code flow against worker-oidc instead of worker-auth's Google sign-in and admin plugin, with the user-management dashboard deferred to a future release. worker-oidc gained real /login, /signup, and /consent pages plus a guarded bootstrap route to register OAuth clients. @capstone/auth-verify's role claim is now optional since worker-oidc tokens do not carry role data.
