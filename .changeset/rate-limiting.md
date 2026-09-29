---
'@capstone/openid-connect': minor
---

Enable real, atomic, D1-backed rate limiting on the credential/token-guessing surface (sign-in, password-reset request and redemption, invite-token redemption). Better Auth's built-in limiter had never actually been on in this deployment: it only defaults to enabled when `NODE_ENV === 'production'`, which Cloudflare Workers never sets. Storage is `'database'`, reusing the existing `OIDC_DB` D1 binding rather than adding a new Cloudflare binding.
