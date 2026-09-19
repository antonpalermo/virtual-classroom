# @capstone/admin

## 0.1.0

### Minor Changes

- 227f44b: Add worker-admin, a passthrough Cloudflare Worker for admin operations (user management, role assignment), backed by new `admin`/`bearer` Better Auth plugins and an `ADMIN_USER_IDS` bootstrap mechanism in worker-auth.
- 6e3500c: Add a three-tier admin/manager/user role model to worker-auth (real per-role access control, not just an admin/not-admin boolean), and a working dashboard in worker-admin to sign in and manage users with it. worker-admin's sign-in flow rides a bearer-token round-trip through worker-client's existing `/login` route.
- b71aba3: Scaffold a React 19 + TanStack Router frontend for worker-admin, built with Vite and served as static assets, mirroring worker-client's layout. Placeholder page only — no user-management UI yet.
- 03e87c9: worker-auth now hosts its own login page and issues a signed JWT after sign-in, so worker-client and worker-admin redirect there directly and verify sessions locally instead of relaying an opaque bearer token through worker-client's login page. Adds the new `@capstone/auth-verify` package for local JWT verification against worker-auth's JWKS. worker-admin's admin-plugin API calls (setRole/ban/unban/remove) keep using the existing bearer session token, unchanged.
- a206b05: worker-admin now signs in via PKCE authorization code flow against worker-oidc instead of worker-auth's Google sign-in and admin plugin, with the user-management dashboard deferred to a future release. worker-oidc gained real /login, /signup, and /consent pages plus a guarded bootstrap route to register OAuth clients. @capstone/auth-verify's role claim is now optional since worker-oidc tokens do not carry role data.

### Patch Changes

- b71aba3: Centralize worker-client's and worker-admin's Vite/React tsconfig bases into `@capstone/typescript/configs` (`tsconfig.app.json`, `tsconfig.node.json`), removing duplicated compilerOptions and a latent `tsBuildInfoFile` cache-path collision between the two workspaces. worker-admin's passthrough worker now type-checks under the same rules as worker-client's byte-identical one, instead of the stricter Workers-runtime base.
- Updated dependencies [03e87c9]
- Updated dependencies [a206b05]
    - @capstone/auth-verify@0.1.0
