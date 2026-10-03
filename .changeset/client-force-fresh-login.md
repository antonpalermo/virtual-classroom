---
"@capstone/client": patch
---

Force fresh authentication on sign-in (`prompt=login`) so a live worker-oidc session from another user — e.g. a worker-admin sign-in — isn't silently reused.
