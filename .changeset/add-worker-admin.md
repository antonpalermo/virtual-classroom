---
"@capstone/admin": minor
"@capstone/auth": patch
---

Add worker-admin, a passthrough Cloudflare Worker for admin operations (user management, role assignment), backed by new `admin`/`bearer` Better Auth plugins and an `ADMIN_USER_IDS` bootstrap mechanism in worker-auth.
