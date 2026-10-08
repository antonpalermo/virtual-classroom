# @capstone/auth-verify

Verifies a `worker-oidc`-issued JWT against its JWKS endpoint.

```ts
import { verifyAccessToken } from '@capstone/auth-verify'

const claims = await verifyAccessToken(token, jwksUrl) // { sub, email, role, exp } | null
```

Returns `null` on any verification failure. JWKS fetchers are cached per URL. Used by `worker-client` and `worker-admin`.

```sh
npm run test:run
```
