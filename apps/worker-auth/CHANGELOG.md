# @capstone/auth

## 0.1.0

### Minor Changes

- 6e3500c: Add a three-tier admin/manager/user role model to worker-auth (real per-role access control, not just an admin/not-admin boolean), and a working dashboard in worker-admin to sign in and manage users with it. worker-admin's sign-in flow rides a bearer-token round-trip through worker-client's existing `/login` route.
- 03e87c9: worker-auth now hosts its own login page and issues a signed JWT after sign-in, so worker-client and worker-admin redirect there directly and verify sessions locally instead of relaying an opaque bearer token through worker-client's login page. Adds the new `@capstone/auth-verify` package for local JWT verification against worker-auth's JWKS. worker-admin's admin-plugin API calls (setRole/ban/unban/remove) keep using the existing bearer session token, unchanged.

### Patch Changes

- 227f44b: Add worker-admin, a passthrough Cloudflare Worker for admin operations (user management, role assignment), backed by new `admin`/`bearer` Better Auth plugins and an `ADMIN_USER_IDS` bootstrap mechanism in worker-auth.
