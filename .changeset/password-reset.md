---
'@capstone/openid-connect': minor
---

Adds self-service password reset: `/forgot-password` requests a reset (`POST /api/auth/request-password-reset`), Better Auth emails a one-time link via our custom email platform (`worker/send-password-reset-email.ts`, configured by `EMAIL_PROVIDER_ENDPOINT`/`EMAIL_PROVIDER_SECRET_KEY`), and `/reset-password` sets the new password (`POST /api/auth/reset-password`). Reuses Better Auth's own built-in reset-password endpoints and `verification` table rather than a hand-rolled token flow, and revokes any existing sessions on a successful reset. Requires a sending domain verified with the email platform, `RESET_EMAIL_FROM` set to an address on it, and `EMAIL_PROVIDER_SECRET_KEY` set via `wrangler secret put` — until then the request still succeeds generically, but no email is actually sent.
