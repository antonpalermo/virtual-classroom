---
'@capstone/openid-connect': patch
---

Hide the OAuth-client bootstrap user from the admin users API: it's no longer listed and every `/api/admin/users/:id` route 404s for it, so deleting it can't cascade away every registered OAuth client.
