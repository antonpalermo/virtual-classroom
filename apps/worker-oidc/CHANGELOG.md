# @capstone/openid-connect

## 0.5.0

### Minor Changes

- 05cd822: Add `@capstone/ui` shared shadcn/ui package (Base UI, Tailwind v4) and wire it into the client, admin, and oidc apps.

### Patch Changes

- Updated dependencies [05cd822]
    - @capstone/ui@0.1.0

## 0.4.0

### Minor Changes

- aac6b5a: Email the invite link when an admin creates a user, and add a "Resend invite" action for users who haven't accepted yet. A failed send still creates the user and returns the link so the admin can copy it.

## 0.3.0

### Minor Changes

- ed51590: Let admins pick a role (`user` or `admin`) when creating a user
- 168c8b9: Adds self-service password reset: `/forgot-password` requests a reset (`POST /api/auth/request-password-reset`), Better Auth emails a one-time link via our custom email platform (`worker/send-password-reset-email.ts`, configured by `EMAIL_PROVIDER_ENDPOINT`/`EMAIL_PROVIDER_SECRET_KEY`), and `/reset-password` sets the new password (`POST /api/auth/reset-password`). Reuses Better Auth's own built-in reset-password endpoints and `verification` table rather than a hand-rolled token flow, and revokes any existing sessions on a successful reset. Requires a sending domain verified with the email platform, `RESET_EMAIL_FROM` set to an address on it, and `EMAIL_PROVIDER_SECRET_KEY` set via `wrangler secret put` — until then the request still succeeds generically, but no email is actually sent.
- b3165fc: Enable real, atomic, D1-backed rate limiting on the credential/token-guessing surface (sign-in, password-reset request and redemption, invite-token redemption). Better Auth's built-in limiter had never actually been on in this deployment: it only defaults to enabled when `NODE_ENV === 'production'`, which Cloudflare Workers never sets. Storage is `'database'`, reusing the existing `OIDC_DB` D1 binding rather than adding a new Cloudflare binding.

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
