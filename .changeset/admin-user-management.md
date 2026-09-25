---
'@capstone/openid-connect': minor
'@capstone/admin': minor
'@capstone/auth-verify': minor
---

Admin-only user-management CRUD for worker-admin, backed by a new `/api/admin/*` REST API in worker-oidc: list/create/edit-role/ban/unban/delete users, gated by a bearer JWT plus a fresh-from-D1 role check. Account creation goes through a one-time invite link (`/accept-invite`, `POST /api/invites/accept`) since there's still no self-service sign-up. Adds `role`/`banned`/`banReason`/`banExpires` to worker-oidc's `user` table and a new `invite` table; the id_token now carries a `role` claim (worker-admin uses it for UI gating only — the admin API re-checks role/ban status against D1 on every call). Banned users are rejected at sign-in via a `databaseHooks.session.create.before` hook, with an already-expired ban auto-lifted on the next sign-in attempt.

`@capstone/auth-verify` gains `verifyAccessTokenWithJwks` (in-process verification against a locally-held JWKS, used by worker-oidc's own admin API to avoid a self-HTTP round trip) and fixes `verifyAccessToken`'s remote-JWKS path to not wait out jose's 30s cooldown when it encounters an unfamiliar signing key.
