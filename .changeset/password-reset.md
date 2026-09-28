---
'@capstone/openid-connect': minor
---

Adds self-service password reset: `/forgot-password` requests a reset (`POST /api/auth/request-password-reset`), Better Auth emails a one-time link via a new Cloudflare Email Service integration (`send_email` binding, `worker/send-password-reset-email.ts`), and `/reset-password` sets the new password (`POST /api/auth/reset-password`). Reuses Better Auth's own built-in reset-password endpoints and `verification` table rather than a hand-rolled token flow, and revokes any existing sessions on a successful reset. Requires onboarding a real sending domain via `wrangler email sending enable <domain>` and setting `RESET_EMAIL_FROM` before real email delivery works in a deployed environment — until then the request still succeeds generically, but no email is actually sent.
