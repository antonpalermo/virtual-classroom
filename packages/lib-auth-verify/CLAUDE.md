# CLAUDE.md — lib-auth-verify

`@capstone/auth-verify` — one function, `verifyAccessToken(token, jwksUrl)` (`src/verify-access-token.ts`), verifying a worker-oidc-issued JWT against a remote JWKS via `jose`'s `createRemoteJWKSet`/`jwtVerify`. Returns the decoded `AccessTokenClaims` (`sub`, `email`, `role`, `exp` — its one exported type) on success, `null` on any verification failure (expired, malformed, wrong signature, missing required claim). `createRemoteJWKSet` instances are cached per JWKS URL at module scope so repeated calls reuse the same key-set fetcher instead of re-fetching every time.

Consumed by `apps/worker-client` and `apps/worker-admin`, both of which call it against worker-oidc's `/api/auth/jwks` endpoint to check a stored `id_token` locally without a round trip to worker-oidc.

## Commands (run from this directory, or via `npm run <script> -w @capstone/auth-verify` from root)

- `test` / `test:run` — Vitest
- `lint` — `biome check .`
