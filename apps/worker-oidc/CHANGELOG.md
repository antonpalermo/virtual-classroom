# @capstone/openid-connect

## 0.1.0

### Minor Changes

- a206b05: worker-admin now signs in via PKCE authorization code flow against worker-oidc instead of worker-auth's Google sign-in and admin plugin, with the user-management dashboard deferred to a future release. worker-oidc gained real /login, /signup, and /consent pages plus a guarded bootstrap route to register OAuth clients. @capstone/auth-verify's role claim is now optional since worker-oidc tokens do not carry role data.
- 347196d: worker-oidc's login, signup, and consent pages are now a Vite + React + TanStack Router SPA instead of hand-written HTML strings served by the Hono app. The Worker now only handles /api/auth/* and /internal/*; everything else is served as static assets. No behavior change to the OAuth/OIDC flow itself.
