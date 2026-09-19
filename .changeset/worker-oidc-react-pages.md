---
"@capstone/openid-connect": minor
---

worker-oidc's login, signup, and consent pages are now a Vite + React + TanStack Router SPA instead of hand-written HTML strings served by the Hono app. The Worker now only handles /api/auth/* and /internal/*; everything else is served as static assets. No behavior change to the OAuth/OIDC flow itself.
