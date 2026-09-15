---
"@capstone/auth": minor
"@capstone/client": minor
"@capstone/admin": minor
"@capstone/auth-verify": minor
---

worker-auth now hosts its own login page and issues a signed JWT after sign-in, so worker-client and worker-admin redirect there directly and verify sessions locally instead of relaying an opaque bearer token through worker-client's login page. Adds the new `@capstone/auth-verify` package for local JWT verification against worker-auth's JWKS. worker-admin's admin-plugin API calls (setRole/ban/unban/remove) keep using the existing bearer session token, unchanged.
