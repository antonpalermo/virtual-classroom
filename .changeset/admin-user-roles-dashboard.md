---
"@capstone/auth": minor
"@capstone/admin": minor
"@capstone/client": patch
---

Add a three-tier admin/manager/user role model to worker-auth (real per-role access control, not just an admin/not-admin boolean), and a working dashboard in worker-admin to sign in and manage users with it. worker-admin's sign-in flow rides a bearer-token round-trip through worker-client's existing `/login` route.
