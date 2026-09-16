# Central IdP: Hosted Login + JWT Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `worker-auth` hosts its own login page; `worker-client` and `worker-admin` redirect straight to it and get back a signed JWT they can verify locally, replacing the current hack where `worker-admin` borrows `worker-client`'s login page via a URL-fragment bearer-token relay.

**Architecture:** `worker-auth` gains a `GET /login` + `GET /login/complete` pair (outside the `/api/auth/*` Better Auth mount) that own the `returnTo` allowlist, drive Google sign-in, and redirect back to the caller with `#token=<jwt>&session=<bearer token>`. A new tiny shared package, `@capstone/auth-verify`, gives `worker-client`/`worker-admin` a `verifyAccessToken()` helper that checks the JWT against `worker-auth`'s public JWKS. The existing opaque bearer-token mechanism (used only for `worker-auth`'s `/api/auth/admin/*` calls) is untouched.

**Tech Stack:** Hono (worker-auth), Better Auth `jwt()` plugin, `jose` (JWT verification), React 19 + TanStack Router (worker-client/worker-admin SPAs), Vitest (`@cloudflare/vitest-pool-workers` for Worker-side tests, plain Vitest for the new package).

**Spec:** `docs/superpowers/specs/2026-09-15-central-idp-hosted-login-design.md`

## Global Constraints

- `worker-auth` hosts its own `/login`; `worker-client` and `worker-admin` redirect there directly — never to each other.
- The `returnTo` allowlist (`ALLOWED_RETURN_ORIGINS`) lives only in `worker-auth`. An unrecognized `returnTo` is rejected there, before any redirect happens.
- The JWT carries a `role` claim and is verified locally (via `worker-auth`'s public JWKS) by consuming apps — no per-request round trip to `worker-auth`.
- `worker-auth`'s `/api/auth/admin/*` endpoints keep using the existing opaque bearer session token, unchanged. Do not attempt to make them accept the JWT in this pass.
- No email/password auth, password reset, MFA, or `worker-realtime` changes in this pass.
- No refresh tokens or long-lived sessions — an expired JWT just means signing in again.

---

## Task 1: `@capstone/auth-verify` package — `verifyAccessToken`

**Files:**
- Create: `packages/lib-auth-verify/package.json`
- Create: `packages/lib-auth-verify/tsconfig.json`
- Create: `packages/lib-auth-verify/vitest.config.mjs`
- Create: `packages/lib-auth-verify/src/verify-access-token.ts`
- Test: `packages/lib-auth-verify/test/verify-access-token.test.ts`

**Interfaces:**
- Produces: `verifyAccessToken(token: string, jwksUrl: string): Promise<AccessTokenClaims | null>` and `export interface AccessTokenClaims { sub: string; email: string; role: string; exp: number }`, both exported from `@capstone/auth-verify` (package root export). Tasks 4 and 5 import both.

- [ ] **Step 1: Scaffold the package**

Create `packages/lib-auth-verify/package.json`:

```json
{
    "name": "@capstone/auth-verify",
    "version": "0.0.0",
    "private": true,
    "scripts": {
        "lint": "biome check .",
        "test": "vitest",
        "test:run": "vitest run"
    },
    "dependencies": {
        "jose": "^6.2.3"
    },
    "devDependencies": {
        "@capstone/typescript": "*",
        "typescript": "^7.0.2",
        "vitest": "^4.1.11"
    },
    "exports": {
        ".": {
            "types": "./src/verify-access-token.ts"
        }
    },
    "license": "MIT"
}
```

Create `packages/lib-auth-verify/tsconfig.json`:

```json
{
    "extends": "@capstone/typescript/configs/tsconfig.lib.json",
    "compilerOptions": {
        "outDir": "./dist"
    },
    "include": ["src"],
    "exclude": ["dist", "node_modules"]
}
```

Create `packages/lib-auth-verify/vitest.config.mjs`:

```js
import { defineConfig } from 'vitest/config'

export default defineConfig({})
```

- [ ] **Step 2: Run `npm install` from the repo root**

Run: `npm install`
Expected: the new workspace is linked (`node_modules/@capstone/auth-verify` symlinked), `jose`/`vitest` installed for it, no errors.

- [ ] **Step 3: Write the failing tests**

Create `packages/lib-auth-verify/test/verify-access-token.test.ts`:

```ts
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { verifyAccessToken } from '../src/verify-access-token'

const JWKS_URL = 'https://auth.example.test/api/auth/jwks'

let privateKey: CryptoKey
let publicJwk: Record<string, unknown>

beforeAll(async () => {
    const { privateKey: priv, publicKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' })
    privateKey = priv
    publicJwk = { ...(await exportJWK(publicKey)), alg: 'EdDSA', use: 'sig', kid: 'test-key' }

    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string | URL) => {
            if (input.toString() === JWKS_URL) {
                return new Response(JSON.stringify({ keys: [publicJwk] }), {
                    headers: { 'content-type': 'application/json' }
                })
            }
            throw new Error(`unexpected fetch: ${input}`)
        })
    )
})

async function signToken(claims: Record<string, unknown>, expiresIn = '15m') {
    return new SignJWT(claims).setProtectedHeader({ alg: 'EdDSA', kid: 'test-key' }).setIssuedAt().setExpirationTime(expiresIn).sign(privateKey)
}

describe('verifyAccessToken', () => {
    it('returns claims for a valid token', async () => {
        const token = await signToken({ sub: 'user-1', email: 'a@example.com', role: 'admin' })
        const result = await verifyAccessToken(token, JWKS_URL)
        expect(result).toMatchObject({ sub: 'user-1', email: 'a@example.com', role: 'admin' })
    })

    it('returns null for an expired token', async () => {
        const token = await signToken({ sub: 'user-1', email: 'a@example.com', role: 'admin' }, '-10s')
        const result = await verifyAccessToken(token, JWKS_URL)
        expect(result).toBeNull()
    })

    it('returns null for a bad signature', async () => {
        const { privateKey: otherKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' })
        const token = await new SignJWT({ sub: 'user-1', email: 'a@example.com', role: 'admin' })
            .setProtectedHeader({ alg: 'EdDSA', kid: 'test-key' })
            .setIssuedAt()
            .setExpirationTime('15m')
            .sign(otherKey)
        const result = await verifyAccessToken(token, JWKS_URL)
        expect(result).toBeNull()
    })

    it('returns null for a malformed token', async () => {
        const result = await verifyAccessToken('not-a-jwt', JWKS_URL)
        expect(result).toBeNull()
    })

    it('returns null when the role claim is missing', async () => {
        const token = await signToken({ sub: 'user-1', email: 'a@example.com' })
        const result = await verifyAccessToken(token, JWKS_URL)
        expect(result).toBeNull()
    })
})
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npm run test:run -w @capstone/auth-verify`
Expected: FAIL — `Cannot find module '../src/verify-access-token'` (the file doesn't exist yet).

- [ ] **Step 5: Implement `verifyAccessToken`**

Create `packages/lib-auth-verify/src/verify-access-token.ts`:

```ts
import { createRemoteJWKSet, jwtVerify } from 'jose'

export interface AccessTokenClaims {
    sub: string
    email: string
    role: string
    exp: number
}

// createRemoteJWKSet does its own internal caching of the fetched key set, but only if the same
// instance is reused across calls — a fresh instance per call would re-fetch every time.
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

function getJwks(jwksUrl: string) {
    let jwks = jwksCache.get(jwksUrl)
    if (!jwks) {
        jwks = createRemoteJWKSet(new URL(jwksUrl))
        jwksCache.set(jwksUrl, jwks)
    }
    return jwks
}

export async function verifyAccessToken(token: string, jwksUrl: string): Promise<AccessTokenClaims | null> {
    try {
        const { payload } = await jwtVerify(token, getJwks(jwksUrl))
        if (typeof payload.sub !== 'string' || typeof payload.email !== 'string' || typeof payload.role !== 'string') {
            return null
        }
        return { sub: payload.sub, email: payload.email, role: payload.role, exp: payload.exp ?? 0 }
    } catch {
        return null
    }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test:run -w @capstone/auth-verify`
Expected: PASS, 5/5 tests.

- [ ] **Step 7: Lint and commit**

Run: `npm run lint --filter=@capstone/auth-verify`

```bash
git add packages/lib-auth-verify
git commit -m "$(cat <<'EOF'
feat(auth-verify): add verifyAccessToken JWT verification helper

- add @capstone/auth-verify package with verifyAccessToken and AccessTokenClaims
- verify against a remote JWKS via jose, memoized per JWKS URL
EOF
)"
```

---

## Task 2: `worker-auth` central config — origin, allowlist, JWT payload

**Files:**
- Modify: `apps/worker-auth/src/auth.ts`
- Modify: `apps/worker-auth/.dev.vars`
- Modify: `apps/worker-auth/.dev.vars.example`

**Interfaces:**
- Produces: `env.ALLOWED_RETURN_ORIGINS` (comma-separated string, parsed the same way `ADMIN_USER_IDS` already is), a JWT payload that includes `role`, and `BETTER_AUTH_URL` now pointing at `worker-auth`'s own origin. Task 3 reads `env.ALLOWED_RETURN_ORIGINS` and relies on the JWT's `role` claim.

- [ ] **Step 1: Update `BETTER_AUTH_URL` and add `ALLOWED_RETURN_ORIGINS`**

Edit `apps/worker-auth/.dev.vars` — change `BETTER_AUTH_URL` and add the new var:

```
BETTER_AUTH_URL=http://localhost:8789
ALLOWED_RETURN_ORIGINS=http://localhost:5173,http://localhost:8790
```

(Leave `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BETTER_AUTH_SECRET`, `ADMIN_USER_IDS` as they are.)

Edit `apps/worker-auth/.dev.vars.example` the same way (mirroring existing blank-value convention for secrets, non-blank for these two):

```
BETTER_AUTH_URL=http://localhost:8789
ALLOWED_RETURN_ORIGINS=http://localhost:5173,http://localhost:8790
```

> **Manual step, not code:** Google Cloud Console's OAuth client's authorized redirect URI must be updated from `http://localhost:5173/api/auth/callback/google` to `http://localhost:8789/api/auth/callback/google` (and the equivalent for the deployed origins) — `BETTER_AUTH_URL` drives Google's `redirect_uri` directly. Do this alongside deploying this change; local dev sign-in will fail with a Google `redirect_uri_mismatch` error until it's done.

- [ ] **Step 2: Update `trustedOrigins` and the `jwt()` plugin's payload in `auth.ts`**

In `apps/worker-auth/src/auth.ts`, replace the `trustedOrigins` line and comment above it:

```ts
        // 'https://example.com' matches the origin the test suite's synthetic requests use.
        // 'http://localhost:8790' and 'http://localhost:5173' are worker-admin's and
        // worker-client's fixed local dev origins — neither has a cookie of its own on this
        // worker, but both call /api/auth/* directly now that BETTER_AUTH_URL points here.
        trustedOrigins: [env.BETTER_AUTH_URL, 'https://example.com', 'http://localhost:8790', 'http://localhost:5173'],
```

Replace the `jwt()` plugin entry in the `plugins` array:

```ts
            jwt({
                jwt: {
                    // Keep the token minimal — just what worker-client/worker-admin need for
                    // local role/identity checks, not the whole user row.
                    definePayload: ({ user }) => ({ email: user.email, role: user.role })
                }
            }),
```

- [ ] **Step 3: Regenerate types**

Run: `npm run typegen -w @capstone/auth`
Expected: `apps/worker-auth/worker-configuration.d.ts` regenerates with no errors; `env.ALLOWED_RETURN_ORIGINS` is now a valid, typed property.

- [ ] **Step 4: Run the existing test suite to confirm nothing broke**

Run: `npm run test:run -w @capstone/auth`
Expected: PASS — these are config-only changes; no existing test asserts the old `BETTER_AUTH_URL` value or the default JWT payload.

- [ ] **Step 5: Commit**

`apps/worker-auth/.dev.vars` is gitignored (local secrets) — edit it locally so tests can run, but never stage or commit it. Only `.dev.vars.example` is tracked.

```bash
git add apps/worker-auth/src/auth.ts apps/worker-auth/.dev.vars.example apps/worker-auth/worker-configuration.d.ts
git commit -m "$(cat <<'EOF'
feat(auth): point BETTER_AUTH_URL at worker-auth's own origin

- add ALLOWED_RETURN_ORIGINS, the central returnTo allowlist for hosted login
- trust worker-client's and worker-admin's dev origins directly
- include role in the jwt() plugin's token payload
EOF
)"
```

---

## Task 3: `worker-auth` — hosted `/login` + `/login/complete` + JWT handoff

**Files:**
- Create: `apps/worker-auth/src/hosted-login.ts`
- Modify: `apps/worker-auth/src/index.ts`
- Test: `apps/worker-auth/test/hosted-login.test.ts`

**Interfaces:**
- Consumes: `createAuth(db, env)` from `./auth` (existing), `createDb(d1)` from `./db/client` (existing), `env.ALLOWED_RETURN_ORIGINS` from Task 2.
- Produces: `registerHostedLogin(app: Hono<{ Bindings: Env }>): void`, mounting `GET /login` and `GET /login/complete`. `GET /login` renders an HTML page whose button POSTs to `/api/auth/sign-in/social` with `callbackURL: '/login/complete?returnTo=<value>'`. `GET /login/complete` 302-redirects to `${returnTo}#token=<jwt>&session=<bearer token>`. Tasks 4 and 5 rely on that exact fragment shape (`token=`/`session=`, `&`-joined, each `encodeURIComponent`-encoded).

- [ ] **Step 1: Write the failing tests**

Create `apps/worker-auth/test/hosted-login.test.ts`:

```ts
import { decodeJwt } from 'jose'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { callAsApp } from './helpers/call-app'
import { googleNetwork, mockGoogleAccount } from './helpers/google-network'

const RETURN_ORIGIN = 'https://client.example.test'
const RETURN_TO = `${RETURN_ORIGIN}/auth-callback`

beforeAll(() => googleNetwork.enable())
afterEach(() => googleNetwork.resetHandlers())
afterAll(() => googleNetwork.disable())

describe('GET /login', () => {
    it('rejects a returnTo that is not on the allowlist', async () => {
        const response = await callAsApp(new Request('https://example.com/login?returnTo=https://evil.example.test/steal'), {
            ALLOWED_RETURN_ORIGINS: RETURN_ORIGIN
        })
        expect(response.status).toBe(400)
    })

    it('renders the sign-in page for an allowlisted returnTo', async () => {
        const response = await callAsApp(new Request(`https://example.com/login?returnTo=${encodeURIComponent(RETURN_TO)}`), {
            ALLOWED_RETURN_ORIGINS: RETURN_ORIGIN
        })
        expect(response.status).toBe(200)
        const html = await response.text()
        expect(html).toContain('Sign in with Google')
    })
})

describe('GET /login/complete', () => {
    async function completeGoogleSignIn(profile: { sub: string; email: string; name: string }, callbackURL: string) {
        mockGoogleAccount(profile)

        const authorizeResponse = await callAsApp(
            new Request('https://example.com/api/auth/sign-in/social', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ provider: 'google', callbackURL })
            })
        )
        const { url } = await authorizeResponse.json<{ url: string }>()
        const state = new URL(url).searchParams.get('state')
        const stateCookie = authorizeResponse.headers.get('set-cookie')?.split(';')[0]

        return callAsApp(
            new Request(`https://example.com/api/auth/callback/google?code=test-code&state=${state}`, {
                headers: { cookie: stateCookie ?? '' }
            })
        )
    }

    it('redirects to returnTo with a JWT and the bearer session token on the fragment', async () => {
        const profile = { sub: 'google-1', email: 'user@example.com', name: 'Test User' }
        const callbackResponse = await completeGoogleSignIn(profile, `/login/complete?returnTo=${encodeURIComponent(RETURN_TO)}`)

        const sessionToken = callbackResponse.headers.get('set-auth-token')
        expect(sessionToken).toBeTruthy()

        const sessionCookie = callbackResponse.headers
            .getSetCookie()
            .find(entry => entry.includes('session_token'))
            ?.split(';')[0]
        expect(sessionCookie).toBeTruthy()

        const completeUrl = new URL(callbackResponse.headers.get('location') ?? '', 'https://example.com')

        const completeResponse = await callAsApp(new Request(completeUrl, { headers: { cookie: sessionCookie ?? '' } }), {
            ALLOWED_RETURN_ORIGINS: RETURN_ORIGIN
        })

        expect(completeResponse.status).toBe(302)
        const finalLocation = completeResponse.headers.get('location') ?? ''
        expect(finalLocation.startsWith(RETURN_TO)).toBe(true)

        const fragment = new URL(finalLocation).hash.slice(1)
        const params = new URLSearchParams(fragment)
        const jwt = params.get('token')
        expect(jwt).toBeTruthy()
        expect(params.get('session')).toBe(sessionToken)

        const claims = decodeJwt(jwt ?? '')
        expect(claims.email).toBe(profile.email)
        expect(claims.role).toBe('user')
    })

    it('rejects a returnTo that is not on the allowlist', async () => {
        const response = await callAsApp(
            new Request('https://example.com/login/complete?returnTo=https://evil.example.test/steal&session=whatever'),
            { ALLOWED_RETURN_ORIGINS: RETURN_ORIGIN }
        )
        expect(response.status).toBe(400)
    })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:run -w @capstone/auth`
Expected: FAIL — `GET /login` and `GET /login/complete` don't exist yet (404s where the tests expect 400/200/302).

- [ ] **Step 3: Implement `hosted-login.ts`**

Create `apps/worker-auth/src/hosted-login.ts`:

```ts
import type { Hono } from 'hono'
import { createAuth } from './auth'
import { createDb } from './db/client'

function parseAllowedReturnOrigins(env: Env): string[] {
    return env.ALLOWED_RETURN_ORIGINS?.split(',')
        .map(origin => origin.trim())
        .filter(Boolean) ?? []
}

function isAllowedReturnTo(returnTo: string, allowedOrigins: string[]): boolean {
    return allowedOrigins.some(origin => returnTo === origin || returnTo.startsWith(`${origin}/`))
}

function loginPage(completeUrl: string): string {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Sign in</title>
</head>
<body>
<h3>Sign in</h3>
<button id="google-sign-in" type="button">Sign in with Google</button>
<script>
document.getElementById('google-sign-in').addEventListener('click', async () => {
    const response = await fetch('/api/auth/sign-in/social', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'google', callbackURL: ${JSON.stringify(completeUrl)} })
    })
    const { url } = await response.json()
    window.location.href = url
})
</script>
</body>
</html>`
}

export function registerHostedLogin(app: Hono<{ Bindings: Env }>) {
    app.get('/login', c => {
        const returnTo = c.req.query('returnTo')
        const allowedOrigins = parseAllowedReturnOrigins(c.env)
        if (!returnTo || !isAllowedReturnTo(returnTo, allowedOrigins)) {
            return c.text('Unrecognized returnTo', 400)
        }
        const completeUrl = `/login/complete?returnTo=${encodeURIComponent(returnTo)}`
        return c.html(loginPage(completeUrl))
    })

    app.get('/login/complete', async c => {
        const returnTo = c.req.query('returnTo')
        const sessionToken = c.req.query('session')
        const allowedOrigins = parseAllowedReturnOrigins(c.env)
        if (!returnTo || !sessionToken || !isAllowedReturnTo(returnTo, allowedOrigins)) {
            return c.text('Unrecognized returnTo', 400)
        }

        const db = createDb(c.env.AUTH_DB)
        const auth = createAuth(db, c.env)
        const tokenResponse = await auth.handler(
            new Request(new URL('/api/auth/token', c.req.url), {
                headers: { cookie: c.req.header('cookie') ?? '' }
            })
        )
        if (!tokenResponse.ok) {
            return c.text('Unable to establish session', 401)
        }
        const { token: jwt } = await tokenResponse.json<{ token: string }>()

        const redirectUrl = new URL(returnTo)
        redirectUrl.hash = `token=${encodeURIComponent(jwt)}&session=${encodeURIComponent(sessionToken)}`
        return c.redirect(redirectUrl.toString(), 302)
    })
}
```

- [ ] **Step 4: Wire `registerHostedLogin` and the callback interception into `index.ts`**

Replace the full content of `apps/worker-auth/src/index.ts`:

```ts
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { createAuth } from './auth'
import { createDb } from './db/client'
import { registerHostedLogin } from './hosted-login'

const app = new Hono<{ Bindings: Env }>()

app.get('/', c => c.text('ok'))

// The JWKS is fetched cross-origin, straight from worker-client's/worker-admin's browser JS (no
// service binding involved there) — it's a set of public keys, safe to open widely.
app.use('/api/auth/jwks', cors())

registerHostedLogin(app)

app.all('/api/auth/*', async c => {
    const db = createDb(c.env.AUTH_DB)
    const auth = createAuth(db, c.env)
    const response = await auth.handler(c.req.raw)

    if (new URL(c.req.url).pathname === '/api/auth/callback/google') {
        const sessionToken = response.headers.get('set-auth-token')
        const location = response.headers.get('location')
        if (sessionToken && location) {
            const redirectUrl = new URL(location, c.req.url)
            redirectUrl.searchParams.set('session', sessionToken)
            const headers = new Headers(response.headers)
            headers.set('location', redirectUrl.toString())
            return new Response(response.body, { status: response.status, headers })
        }
    }

    return response
})

export default app
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:run -w @capstone/auth`
Expected: PASS, including the pre-existing `test/admin.test.ts` and `test/google-sign-in.test.ts` (the callback interception only adds a query param when a `returnTo`-carrying redirect is present — the plain `/` callback used by those tests is untouched, since it has no `returnTo` param — wait, this is only true if `redirectUrl.searchParams.set('session', ...)` always fires when `sessionToken && location` are present, regardless of `returnTo`. Read `test/google-sign-in.test.ts` and `test/admin.test.ts` before this step and confirm their assertions don't check the callback's exact `location` header value — if either does, update its expected `location` string to include the added `&session=...` (or `?session=...`) query param).

- [ ] **Step 6: Lint and commit**

Run: `npm run lint --filter=@capstone/auth`

```bash
git add apps/worker-auth/src/hosted-login.ts apps/worker-auth/src/index.ts apps/worker-auth/test/hosted-login.test.ts
git commit -m "$(cat <<'EOF'
feat(auth): host /login and /login/complete on worker-auth

- add registerHostedLogin: allowlist-gated returnTo, Google sign-in, JWT mint
- carry the bearer session token from the Google callback into /login/complete
- redirect back to returnTo with #token=<jwt>&session=<bearer token>
- enable CORS on /api/auth/jwks for cross-origin browser verification
EOF
)"
```

---

## Task 4: `worker-client` — redirect to hosted login, verify locally

**Files:**
- Modify: `apps/worker-client/src/routes/login.tsx`
- Create: `apps/worker-client/src/routes/auth-callback.tsx`
- Modify: `apps/worker-client/src/lib/auth-client.ts` (replaced by `src/lib/session.ts`, old file deleted)
- Modify: `apps/worker-client/src/routes/index.tsx`
- Modify: `apps/worker-client/worker/index.ts`
- Modify: `apps/worker-client/vitest.config.mjs`
- Modify: `apps/worker-client/test/index.test.ts`
- Modify: `apps/worker-client/package.json`

**Interfaces:**
- Consumes: `verifyAccessToken`, `AccessTokenClaims` from `@capstone/auth-verify` (Task 1); the `#token=<jwt>&session=<bearer token>` fragment shape from `worker-auth`'s `/login/complete` (Task 3).
- Produces: `storeSession({ token, session }): void`, `getStoredToken(): string | undefined`, `clearStoredSession(): void`, exported from `src/lib/session.ts`.

- [ ] **Step 1: Delete the old Better Auth client**

Delete `apps/worker-client/src/lib/auth-client.ts` (its only content, `export const authClient = createAuthClient()`, has no remaining callers once this task is done).

- [ ] **Step 2: Create `src/lib/session.ts`**

Create `apps/worker-client/src/lib/session.ts`:

```ts
const TOKEN_KEY = 'client_token'
const SESSION_KEY = 'client_session'

export function storeSession({ token, session }: { token: string; session: string }) {
    sessionStorage.setItem(TOKEN_KEY, token)
    sessionStorage.setItem(SESSION_KEY, session)
}

export function clearStoredSession() {
    try {
        sessionStorage.removeItem(TOKEN_KEY)
        sessionStorage.removeItem(SESSION_KEY)
    } catch {
        // sessionStorage can throw in a locked-down browser; nothing to recover here.
    }
}

export function getStoredToken() {
    try {
        return sessionStorage.getItem(TOKEN_KEY) ?? undefined
    } catch {
        return undefined
    }
}
```

- [ ] **Step 3: Replace `src/routes/login.tsx`**

Replace the full content of `apps/worker-client/src/routes/login.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'

// worker-auth's own hosted login page — this app no longer performs Google sign-in itself.
const AUTH_ORIGIN = 'http://localhost:8789'

export const Route = createFileRoute('/login')({
    component: LoginRoute
})

function LoginRoute() {
    const returnTo = `${window.location.origin}/auth-callback`
    const signInUrl = `${AUTH_ORIGIN}/login?returnTo=${encodeURIComponent(returnTo)}`

    return (
        <div className="p-2">
            <h3>Sign in</h3>
            <a href={signInUrl}>Sign in with Google</a>
        </div>
    )
}
```

- [ ] **Step 4: Create `src/routes/auth-callback.tsx`**

Create `apps/worker-client/src/routes/auth-callback.tsx`:

```tsx
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { storeSession } from '../lib/session'

export const Route = createFileRoute('/auth-callback')({
    component: AuthCallbackRoute
})

function AuthCallbackRoute() {
    const navigate = useNavigate()

    useEffect(() => {
        const params = new URLSearchParams(window.location.hash.slice(1))
        const token = params.get('token')
        const session = params.get('session')
        if (!token || !session) {
            navigate({ to: '/login' })
            return
        }
        storeSession({ token, session })
        navigate({ to: '/' })
    }, [navigate])

    return <p className="p-2">Signing in…</p>
}
```

- [ ] **Step 5: Replace `src/routes/index.tsx`**

Replace the full content of `apps/worker-client/src/routes/index.tsx`:

```tsx
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { type AccessTokenClaims, verifyAccessToken } from '@capstone/auth-verify'
import { useEffect, useState } from 'react'
import { clearStoredSession, getStoredToken } from '../lib/session'

const JWKS_URL = 'http://localhost:8789/api/auth/jwks'

export const Route = createFileRoute('/')({
    component: HomeRoute
})

function HomeRoute() {
    const navigate = useNavigate()
    const [claims, setClaims] = useState<AccessTokenClaims | null | undefined>(undefined)

    useEffect(() => {
        const token = getStoredToken()
        if (!token) {
            setClaims(null)
            return
        }
        verifyAccessToken(token, JWKS_URL).then(setClaims)
    }, [])

    const isPending = claims === undefined

    function createRoom() {
        const id = crypto.randomUUID()
        navigate({ from: '/', to: '/room', search: { id } })
    }

    function signOut() {
        clearStoredSession()
        setClaims(null)
    }

    return (
        <div className="p-2">
            <h3>Welcome!</h3>
            {!isPending &&
                (claims ? (
                    <p>
                        Signed in as {claims.email}{' '}
                        <button type="button" onClick={signOut}>
                            Sign out
                        </button>
                    </p>
                ) : (
                    <p>
                        <Link to="/login">Sign in</Link>
                    </p>
                ))}
            <form>
                <div>
                    <label htmlFor="room-id">Join</label>
                    <input type="text" name="room-id" id="room-id" />
                    <button type="submit">Join</button>
                </div>
            </form>
            <br />
            <span>Create a new instan meeting</span>
            <button type="button" onClick={createRoom}>
                Create
            </button>
        </div>
    )
}
```

- [ ] **Step 6: Simplify `worker/index.ts`**

Replace the full content of `apps/worker-client/worker/index.ts`:

```ts
export default {
    fetch(request, env, _ctx) {
        const url = new URL(request.url)

        if (url.pathname.startsWith('/api/auth/')) {
            return env.AUTH_SERVICE.fetch(request)
        }

        return new Response(null, { status: 404 })
    }
} satisfies ExportedHandler<Env>
```

- [ ] **Step 7: Replace the now-obsolete passthrough tests**

Replace the full content of `apps/worker-client/vitest.config.mjs`:

```js
import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
    plugins: [
        cloudflareTest({
            wrangler: { configPath: './wrangler.jsonc' },
            miniflare: {
                // Overrides wrangler.jsonc's real `AUTH_SERVICE` binding (which points at the
                // separately deployed worker-auth) with a fake handler that echoes back the
                // request it received, so tests can assert the passthrough forwarded the right
                // URL/headers without needing worker-auth running.
                serviceBindings: {
                    AUTH_SERVICE(request) {
                        return new Response(
                            JSON.stringify({
                                url: request.url,
                                authorization: request.headers.get('authorization')
                            }),
                            { status: 200, headers: { 'content-type': 'application/json' } }
                        )
                    }
                }
            }
        })
    ]
})
```

Replace the full content of `apps/worker-client/test/index.test.ts`:

```ts
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { it } from 'vitest'
import app from '../worker/index'

it('forwards /api/auth/* requests to the AUTH_SERVICE binding', async ({ expect }) => {
    const ctx = createExecutionContext()
    const response = await app.fetch(
        new Request('https://example.com/api/auth/get-session', { headers: { authorization: 'Bearer test-token' } }),
        env,
        ctx
    )
    await waitOnExecutionContext(ctx)

    expect(response.status).toBe(200)
    const body = await response.json<{ url: string; authorization: string | null }>()
    expect(body.url).toBe('https://example.com/api/auth/get-session')
    expect(body.authorization).toBe('Bearer test-token')
})

it('404s any request outside /api/auth/*', async ({ expect }) => {
    const ctx = createExecutionContext()
    const response = await app.fetch(new Request('https://example.com/api/admin/whatever'), env, ctx)
    await waitOnExecutionContext(ctx)

    expect(response.status).toBe(404)
})
```

- [ ] **Step 8: Update `package.json`**

In `apps/worker-client/package.json`: remove `"better-auth": "^1.7.1"` from `dependencies` (no longer imported anywhere in this app), add `"@capstone/auth-verify": "*"` to `dependencies`, and add `"@capstone/typescript": "*"` to `devDependencies` (it was missing — every other workspace declares it explicitly rather than relying on hoisting).

- [ ] **Step 9: Install, typecheck, and run tests**

Run: `npm install`
Run: `npm run check-types --filter=@capstone/client`
Expected: no type errors.
Run: `npm run test:run -w @capstone/client`
Expected: PASS, 2/2 tests.

- [ ] **Step 10: Lint and commit**

Run: `npm run lint --filter=@capstone/client`

```bash
git add apps/worker-client
git commit -m "$(cat <<'EOF'
feat(client): redirect to worker-auth's hosted login

- login.tsx redirects straight to worker-auth's /login, no inline Google sign-in
- add auth-callback.tsx to receive the JWT/session fragment
- verify the stored JWT locally via @capstone/auth-verify instead of authClient.useSession()
- drop worker/index.ts's callback-rewrite hack, now handled by worker-auth itself
EOF
)"
```

---

## Task 5: `worker-admin` — redirect straight to worker-auth, gate via JWT

**Files:**
- Modify: `apps/worker-admin/src/routes/login.tsx`
- Modify: `apps/worker-admin/src/routes/auth-callback.tsx`
- Modify: `apps/worker-admin/src/lib/auth-client.ts`
- Modify: `apps/worker-admin/src/routes/index.tsx`
- Modify: `apps/worker-admin/package.json`

**Interfaces:**
- Consumes: `verifyAccessToken`, `AccessTokenClaims` from `@capstone/auth-verify` (Task 1); the `#token=<jwt>&session=<bearer token>` fragment shape from `worker-auth`'s `/login/complete` (Task 3).
- Produces: `getStoredJwt`/`storeJwt`/`clearStoredJwt` and `getStoredSession`/`storeSession`/`clearStoredSession` from `src/lib/auth-client.ts` (the latter three replace the old `getStoredToken`/`storeToken`/`clearStoredToken`, same purpose — feeding `authClient`'s bearer auth — just renamed for clarity now that there are two stored credentials).

- [ ] **Step 1: Update `src/lib/auth-client.ts`**

Replace the full content of `apps/worker-admin/src/lib/auth-client.ts`:

```ts
import { adminClient } from 'better-auth/client/plugins'
import { createAccessControl } from 'better-auth/plugins/access'
import { createAuthClient } from 'better-auth/react'

// Type-only stand-in for `apps/worker-auth`'s real access-control roles (admin/manager/user).
// The actual authorization decision always happens server-side in worker-auth — this exists
// purely so `authClient.admin.setRole`'s `role` param is typed as including "manager", without
// worker-admin depending on worker-auth's source.
const clientAc = createAccessControl({})
const clientRole = clientAc.newRole({})

// Better Auth's own opaque session token — used only to call /api/auth/admin/* (setRole/ban/etc).
const SESSION_STORAGE_KEY = 'admin_session'
// The signed access token from worker-auth's hosted login — used only for local role/identity checks.
const JWT_STORAGE_KEY = 'admin_jwt'

export function getStoredSession() {
    try {
        return sessionStorage.getItem(SESSION_STORAGE_KEY) ?? undefined
    } catch {
        return undefined
    }
}

export function storeSession(session: string) {
    sessionStorage.setItem(SESSION_STORAGE_KEY, session)
}

export function clearStoredSession() {
    try {
        sessionStorage.removeItem(SESSION_STORAGE_KEY)
    } catch {
        // sessionStorage can throw in a locked-down browser; nothing to recover here.
    }
}

export function getStoredJwt() {
    try {
        return sessionStorage.getItem(JWT_STORAGE_KEY) ?? undefined
    } catch {
        return undefined
    }
}

export function storeJwt(jwt: string) {
    sessionStorage.setItem(JWT_STORAGE_KEY, jwt)
}

export function clearStoredJwt() {
    try {
        sessionStorage.removeItem(JWT_STORAGE_KEY)
    } catch {
        // sessionStorage can throw in a locked-down browser; nothing to recover here.
    }
}

export const authClient = createAuthClient({
    plugins: [adminClient({ roles: { admin: clientRole, manager: clientRole, user: clientRole } })],
    fetchOptions: {
        auth: {
            type: 'Bearer',
            token: getStoredSession
        }
    }
})
```

- [ ] **Step 2: Replace `src/routes/login.tsx`**

Replace the full content of `apps/worker-admin/src/routes/login.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'

// worker-auth's own hosted login page — this app no longer routes through worker-client at all.
const AUTH_ORIGIN = 'http://localhost:8789'

export const Route = createFileRoute('/login')({
    component: LoginRoute
})

function LoginRoute() {
    const returnTo = `${window.location.origin}/auth-callback`
    const signInUrl = `${AUTH_ORIGIN}/login?returnTo=${encodeURIComponent(returnTo)}`

    return (
        <div className="p-2">
            <h3>Sign in</h3>
            <a href={signInUrl}>Sign in with Google</a>
        </div>
    )
}
```

- [ ] **Step 3: Replace `src/routes/auth-callback.tsx`**

Replace the full content of `apps/worker-admin/src/routes/auth-callback.tsx`:

```tsx
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { storeJwt, storeSession } from '../lib/auth-client'

export const Route = createFileRoute('/auth-callback')({
    component: AuthCallbackRoute
})

function AuthCallbackRoute() {
    const navigate = useNavigate()

    useEffect(() => {
        const params = new URLSearchParams(window.location.hash.slice(1))
        const token = params.get('token')
        const session = params.get('session')
        if (!token || !session) {
            navigate({ to: '/login' })
            return
        }
        storeJwt(token)
        storeSession(session)
        navigate({ to: '/' })
    }, [navigate])

    return <p className="p-2">Signing in…</p>
}
```

- [ ] **Step 4: Update `src/routes/index.tsx`'s auth guard to use the JWT**

Replace the full content of `apps/worker-admin/src/routes/index.tsx`:

```tsx
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { type AccessTokenClaims, verifyAccessToken } from '@capstone/auth-verify'
import { useEffect, useState } from 'react'
import { authClient, clearStoredJwt, clearStoredSession, getStoredJwt } from '../lib/auth-client'

const JWKS_URL = 'http://localhost:8789/api/auth/jwks'

type ManagedUser = {
    id: string
    email: string
    role?: string | null
    banned?: boolean | null
}

const ROLE_OPTIONS = ['user', 'manager', 'admin'] as const
type RoleOption = (typeof ROLE_OPTIONS)[number]

export const Route = createFileRoute('/')({
    beforeLoad: () => {
        if (!getStoredJwt()) throw redirect({ to: '/login' })
    },
    component: DashboardRoute
})

function DashboardRoute() {
    // `beforeLoad` only proves a token *string* is in sessionStorage, not that it still verifies.
    // So three states have to stay distinct: still resolving, resolved-but-invalid (the stored
    // JWT is expired/malformed — drop it and go back to /login rather than stranding the user on
    // a permanent "Access denied"), and resolved with real claims.
    const [claims, setClaims] = useState<AccessTokenClaims | null | undefined>(undefined)
    const navigate = useNavigate()
    const [users, setUsers] = useState<ManagedUser[] | null>(null)
    const [loadError, setLoadError] = useState<string | null>(null)

    useEffect(() => {
        const jwt = getStoredJwt()
        if (!jwt) return
        verifyAccessToken(jwt, JWKS_URL).then(setClaims)
    }, [])

    const isPending = claims === undefined
    const tokenIsStale = !isPending && !claims
    const viewerRole = claims?.role ?? 'user'

    useEffect(() => {
        if (!tokenIsStale) return
        clearStoredJwt()
        clearStoredSession()
        navigate({ to: '/login' })
    }, [tokenIsStale, navigate])

    useEffect(() => {
        if (isPending || !claims || viewerRole === 'user') return
        authClient.admin.listUsers({ query: { limit: 100 } }).then(({ data, error }) => {
            if (error) {
                setLoadError(error.message ?? 'Failed to load users')
                return
            }
            setUsers((data?.users as ManagedUser[]) ?? [])
        })
    }, [isPending, claims, viewerRole])

    if (isPending) return <p className="p-2">Loading…</p>
    if (tokenIsStale) return <p className="p-2">Your session has expired. Redirecting to sign in…</p>

    if (viewerRole === 'user') {
        return (
            <div className="p-2">
                <h3>Access denied</h3>
                <p>Your account doesn't have admin or manager access.</p>
            </div>
        )
    }

    async function changeRole(userId: string, role: RoleOption) {
        const { error } = await authClient.admin.setRole({ userId, role })
        if (error) {
            setLoadError(error.message ?? 'Failed to change role')
            return
        }
        setLoadError(null)
        setUsers(current => current?.map(user => (user.id === userId ? { ...user, role } : user)) ?? null)
    }

    async function toggleBan(user: ManagedUser) {
        const action = user.banned ? authClient.admin.unbanUser : authClient.admin.banUser
        const { error } = await action({ userId: user.id })
        if (error) {
            setLoadError(error.message ?? 'Failed to update ban status')
            return
        }
        setLoadError(null)
        setUsers(current => current?.map(u => (u.id === user.id ? { ...u, banned: !u.banned } : u)) ?? null)
    }

    async function removeUser(userId: string) {
        const { error } = await authClient.admin.removeUser({ userId })
        if (error) {
            setLoadError(error.message ?? 'Failed to remove user')
            return
        }
        setLoadError(null)
        setUsers(current => current?.filter(u => u.id !== userId) ?? null)
    }

    const grantableRoles: readonly RoleOption[] = viewerRole === 'admin' ? ROLE_OPTIONS : ROLE_OPTIONS.filter(role => role !== 'admin')

    return (
        <div className="p-2">
            <h3>Users</h3>
            {loadError && <p>{loadError}</p>}
            <table>
                <thead>
                    <tr>
                        <th>Email</th>
                        <th>Role</th>
                        <th>Status</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {users?.map(user => {
                        const lockedForViewer = viewerRole === 'manager' && user.role === 'admin'
                        const currentRole = (user.role ?? 'user') as RoleOption
                        const displayedRoles = grantableRoles.includes(currentRole) ? grantableRoles : [...grantableRoles, currentRole]
                        return (
                            <tr key={user.id}>
                                <td>{user.email}</td>
                                <td>
                                    <select
                                        value={currentRole}
                                        disabled={lockedForViewer}
                                        onChange={event => changeRole(user.id, event.target.value as RoleOption)}
                                    >
                                        {displayedRoles.map(role => (
                                            <option key={role} value={role}>
                                                {role}
                                            </option>
                                        ))}
                                    </select>
                                </td>
                                <td>{user.banned ? 'Banned' : 'Active'}</td>
                                <td>
                                    <button type="button" disabled={lockedForViewer} onClick={() => toggleBan(user)}>
                                        {user.banned ? 'Unban' : 'Ban'}
                                    </button>
                                    <button type="button" disabled={lockedForViewer} onClick={() => removeUser(user.id)}>
                                        Remove
                                    </button>
                                </td>
                            </tr>
                        )
                    })}
                </tbody>
            </table>
        </div>
    )
}
```

- [ ] **Step 5: Update `package.json`**

In `apps/worker-admin/package.json`, add `"@capstone/auth-verify": "*"` to `dependencies`.

- [ ] **Step 6: Install, typecheck, and run tests**

Run: `npm install`
Run: `npm run check-types --filter=@capstone/admin`
Expected: no type errors.
Run: `npm run test:run -w @capstone/admin`
Expected: PASS — `worker/index.ts` and its test are untouched by this task, so the existing 2 tests still pass unmodified.

- [ ] **Step 7: Lint and commit**

Run: `npm run lint --filter=@capstone/admin`

```bash
git add apps/worker-admin
git commit -m "$(cat <<'EOF'
feat(admin): redirect straight to worker-auth's hosted login

- login.tsx no longer routes through worker-client
- auth-callback.tsx captures both the JWT and the bearer session token
- dashboard's role gating now decodes the JWT locally via @capstone/auth-verify
- admin-plugin mutations keep using the existing bearer session token, unchanged
EOF
)"
```

---

## Task 6: End-to-end verification and versioning

**Files:** none (manual verification + `npm run changeset`)

- [ ] **Step 1: Start all three dev servers**

Run in three terminals (or via `npm run dev` from root, which runs all of them via Turborepo):
- `npm run dev -w @capstone/auth` (port 8789)
- `npm run dev -w @capstone/client` (port 5173)
- `npm run dev -w @capstone/admin` (port 8790)

- [ ] **Step 2: Manual check — worker-client sign-in**

In a browser, visit `http://localhost:5173`, click "Sign in", complete Google sign-in. Confirm: you land back on `http://localhost:5173/auth-callback` then `/`, and the home page shows "Signed in as `<your email>`". Click "Sign out" and confirm it reverts to the "Sign in" link.

- [ ] **Step 3: Manual check — worker-admin sign-in (no hop through worker-client)**

Visit `http://localhost:8790` directly (with no prior worker-client session). Click "Sign in". Confirm the browser goes straight to `http://localhost:8789/login` (never to `http://localhost:5173`), completes Google sign-in, and lands back on `http://localhost:8790/auth-callback` then `/`, showing either "Access denied" (`user` role) or the user table (`admin`/`manager` role, per the account's role in the DB — use `ADMIN_USER_IDS` bootstrap per `apps/worker-auth/CLAUDE.md` if needed).

- [ ] **Step 4: Manual check — rejected returnTo**

Visit `http://localhost:8789/login?returnTo=https://evil.example.com/steal` directly. Confirm you get the "Unrecognized returnTo" 400 response, not the sign-in page.

- [ ] **Step 5: Record the version bump**

Run: `npm run changeset`
Select `@capstone/auth`, `@capstone/client`, `@capstone/admin`, and `@capstone/auth-verify`. Write a summary describing the hosted-login move for each.

- [ ] **Step 6: Commit the changeset**

```bash
git add .changeset
git commit -m "$(cat <<'EOF'
chore: add changeset for central-IdP hosted login

- version bump for @capstone/auth, @capstone/client, @capstone/admin, @capstone/auth-verify
EOF
)"
```
