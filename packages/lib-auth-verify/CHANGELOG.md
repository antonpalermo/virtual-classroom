# @capstone/auth-verify

## 0.1.0

### Minor Changes

- 03e87c9: worker-auth now hosts its own login page and issues a signed JWT after sign-in, so worker-client and worker-admin redirect there directly and verify sessions locally instead of relaying an opaque bearer token through worker-client's login page. Adds the new `@capstone/auth-verify` package for local JWT verification against worker-auth's JWKS. worker-admin's admin-plugin API calls (setRole/ban/unban/remove) keep using the existing bearer session token, unchanged.

### Patch Changes

- a206b05: worker-admin now signs in via PKCE authorization code flow against worker-oidc instead of worker-auth's Google sign-in and admin plugin, with the user-management dashboard deferred to a future release. worker-oidc gained real /login, /signup, and /consent pages plus a guarded bootstrap route to register OAuth clients. @capstone/auth-verify's role claim is now optional since worker-oidc tokens do not carry role data.
