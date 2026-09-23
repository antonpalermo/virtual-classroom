---
'@capstone/client': minor
'@capstone/openid-connect': minor
---

worker-client now signs in against worker-oidc (Authorization Code + PKCE) and no longer has a backend Worker or `AUTH_SERVICE` binding; worker-oidc's client bootstrap route is now `/internal/oauth-clients/:name` and accepts `worker-client` alongside `worker-admin`.
