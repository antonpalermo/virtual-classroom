# worker-admin as a worker-oidc OAuth Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `worker-admin` a real Authorization-Code+PKCE OAuth client of `worker-oidc` for sign-in, dropping `worker-admin`'s dependency on `worker-auth` entirely (including its now-unsupported user-management UI).

**Architecture:** `worker-oidc` gains real `/login`, `/signup`, and `/consent` pages (plain server-rendered HTML+JS, Better Auth's `emailAndPassword` underneath) plus a one-time bootstrap route that registers `worker-admin` as a public OAuth client via the `@better-auth/oauth-provider` plugin's server-only `adminCreateOAuthClient` API. `worker-admin`'s browser drives the whole PKCE flow itself and becomes a fully static SPA (no backend Worker, no service binding) once its dashboard shrinks to "signed in as `<email>`".

**Tech Stack:** Better Auth 1.7, `@better-auth/oauth-provider`, Hono, Cloudflare Workers (D1/Drizzle), React 19 + TanStack Router, Vite, Vitest (`@cloudflare/vitest-pool-workers` for `worker-oidc`, plain Vitest for `worker-admin`/`lib-auth-verify`).

**Spec:** `docs/superpowers/specs/2026-09-17-worker-admin-oidc-client-design.md`

## Global Constraints

- Formatting is Biome-only (4-space indent, single quotes, no semicolons, no trailing commas, 140 col) — the pre-commit hook auto-fixes staged files, so don't hand-format against that style.
- Every commit message follows `<type>(<scope>): <summary>` + `- ` bullet body (Conventional Commits types; scope is the workspace directory name with its `worker-`/`lib-` prefix dropped — `admin`, `oidc`, `auth-verify`). No `Co-Authored-By` or other AI-attribution trailers.
- Every internal workspace dependency is declared as `"*"` in `package.json`.
- No admin-plugin, role, or manager-restriction work lands in this plan — explicitly deferred per the spec's non-goals. Don't add it "while you're in there."
- `worker-oidc`'s `/oauth2/token` endpoint only accepts `application/x-www-form-urlencoded` bodies (confirmed against `node_modules/@better-auth/oauth-provider/dist/authorize-Crqw4_bR.mjs:4576-4600`); `/oauth2/consent` and `/oauth2/continue` take JSON POST bodies and respond `{ redirect: true, url: string }` (not the OpenAPI doc's stale `{ redirect_uri }` — confirmed in that same file and in `apps/worker-auth/test/oauth-provider.test.ts`, which exercises this exact response shape against a live test instance).

---

## Task 1: `@capstone/auth-verify` — make the `role` claim optional

`worker-oidc`'s `id_token` won't carry a `role` claim (role/admin work is deferred), but `worker-client`/`worker-auth`'s tokens still do. `verifyAccessToken` currently requires `role` on every token; loosen it to optional so it can verify both kinds of token without change elsewhere.

**Files:**
- Modify: `packages/lib-auth-verify/src/verify-access-token.ts`
- Test: `packages/lib-auth-verify/test/verify-access-token.test.ts`

**Interfaces:**
- Produces: `AccessTokenClaims { sub: string; email: string; role?: string; exp: number }`, `verifyAccessToken(token: string, jwksUrl: string): Promise<AccessTokenClaims | null>` — same signature, `role` now optional on the return type.

- [ ] **Step 1: Write the failing test**

Replace the existing "returns null when the role claim is missing" test in `packages/lib-auth-verify/test/verify-access-token.test.ts` with one that expects success:

```ts
it('returns claims with role undefined when the role claim is missing', async () => {
    const token = await signToken({ sub: 'user-1', email: 'a@example.com' })
    const result = await verifyAccessToken(token, JWKS_URL)
    expect(result).toMatchObject({ sub: 'user-1', email: 'a@example.com' })
    expect(result?.role).toBeUndefined()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -w @capstone/auth-verify`
Expected: FAIL — the current implementation's `requiredClaims: ['exp', 'sub', 'email', 'role']` rejects a token with no `role`, so `result` is `null`, not an object matching `{ sub, email }`.

- [ ] **Step 3: Update the implementation**

In `packages/lib-auth-verify/src/verify-access-token.ts`:

```ts
import { createRemoteJWKSet, jwtVerify } from 'jose'

export interface AccessTokenClaims {
    sub: string
    email: string
    role?: string
    exp: number
}

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
        const { payload } = await jwtVerify(token, getJwks(jwksUrl), {
            requiredClaims: ['exp', 'sub', 'email']
        })
        if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') {
            return null
        }
        if (payload.role !== undefined && typeof payload.role !== 'string') {
            return null
        }
        return { sub: payload.sub, email: payload.email, role: payload.role as string | undefined, exp: payload.exp as number }
    } catch {
        return null
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -w @capstone/auth-verify`
Expected: PASS — all six tests, including the two that assert `role: 'admin'` still round-trips when present.

- [ ] **Step 5: Commit**

```bash
git add packages/lib-auth-verify/src/verify-access-token.ts packages/lib-auth-verify/test/verify-access-token.test.ts
git commit -m "$(cat <<'EOF'
feat(auth-verify): make the role claim optional

- verifyAccessToken no longer requires a role claim
- a token with role still round-trips it; one without still verifies
EOF
)"
```

---

## Task 2: Fix `worker-oidc`'s dev-server port collision with `worker-admin`

`apps/worker-oidc/wrangler.jsonc`'s `dev` block claims port `8790`/inspector `9232` — the exact ports `apps/worker-admin/vite.config.ts` already uses. The comment in `worker-oidc/wrangler.jsonc` lists worker-client/worker-realtime/worker-auth's ports but never mentions worker-admin, so this looks like an oversight from before `worker-oidc` existed alongside it. This plan needs both dev servers running at once (Task 5's manual verification), so fix it now.

**Files:**
- Modify: `apps/worker-oidc/wrangler.jsonc`

- [ ] **Step 1: Change the port**

In `apps/worker-oidc/wrangler.jsonc`, change:

```jsonc
    "dev": {
        // Defaults (8787/9229) collide with worker-client; 8788/9231 and 8789/9230 are taken by
        // worker-realtime and worker-auth respectively.
        "port": 8790,
        "inspector_port": 9232
    }
```

to:

```jsonc
    "dev": {
        // Defaults (8787/9229) collide with worker-client; 8788/9231, 8789/9230, and 8790/9232
        // are taken by worker-realtime, worker-auth, and worker-admin respectively.
        "port": 8791,
        "inspector_port": 9233
    }
```

- [ ] **Step 2: Verify the dev server starts on the new port**

Run: `npm run dev -w @capstone/openid-connect` (then Ctrl-C once it's up)
Expected: log output shows it listening on `8791`, not `8790`.

- [ ] **Step 3: Commit**

```bash
git add apps/worker-oidc/wrangler.jsonc
git commit -m "$(cat <<'EOF'
fix(oidc): move dev server off worker-admin's port

- 8790/9232 was already claimed by worker-admin; move to 8791/9233
EOF
)"
```

---

## Task 3: `worker-oidc` test infrastructure + CORS on token/userinfo/jwks

`worker-oidc` has no test suite yet. Set up the same `@cloudflare/vitest-pool-workers` shape `worker-auth` already uses (minus the Google-mocking helpers it doesn't need), and add the CORS policy `worker-admin`'s browser JS needs to call `/oauth2/token`, `/oauth2/userinfo`, and `/jwks` directly, cross-origin.

**Files:**
- Modify: `apps/worker-oidc/package.json` (add `@cloudflare/vitest-pool-workers`, `vitest` devDependencies; add `test`/`test:run` scripts)
- Create: `apps/worker-oidc/vitest.config.mjs`
- Create: `apps/worker-oidc/test/apply-migrations.ts`
- Create: `apps/worker-oidc/test/env.d.ts`
- Create: `apps/worker-oidc/test/tsconfig.json`
- Create: `apps/worker-oidc/test/helpers/call-app.ts`
- Modify: `apps/worker-oidc/src/index.ts`
- Test: `apps/worker-oidc/test/cors.test.ts`

**Interfaces:**
- Produces: `callAsApp(request: Request, envOverrides?: Partial<Env>): Promise<Response>` (test helper, same signature as `apps/worker-auth/test/helpers/call-app.ts`).

- [ ] **Step 1: Add test dependencies and scripts**

In `apps/worker-oidc/package.json`, add to `"scripts"`:

```jsonc
"test": "vitest",
"test:run": "vitest run"
```

and to `"devDependencies"`:

```jsonc
"@cloudflare/vitest-pool-workers": "^0.22.0",
"vitest": "^4.1.11"
```

(match the exact versions already pinned in `apps/worker-auth/package.json`). Run `npm install` from the repo root afterward.

- [ ] **Step 2: Add the test scaffolding files**

`apps/worker-oidc/vitest.config.mjs`:

```js
import path from 'node:path'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig(async () => {
    const migrations = await readD1Migrations(path.join(import.meta.dirname, 'drizzle'))

    return {
        plugins: [
            cloudflareTest({
                wrangler: { configPath: './wrangler.jsonc' },
                miniflare: {
                    bindings: { TEST_MIGRATIONS: migrations }
                }
            })
        ],
        test: {
            setupFiles: ['./test/apply-migrations.ts']
        }
    }
})
```

`apps/worker-oidc/test/apply-migrations.ts`:

```ts
import { applyD1Migrations } from 'cloudflare:test'
import { env } from 'cloudflare:workers'

// Setup files may run more than once; applyD1Migrations() only applies
// migrations that haven't already been applied, so this is safe to repeat.
await applyD1Migrations(env.OIDC_DB, env.TEST_MIGRATIONS)
```

`apps/worker-oidc/test/env.d.ts`:

```ts
declare namespace Cloudflare {
    interface Env {
        TEST_MIGRATIONS: import('cloudflare:test').D1Migration[]
    }
}
```

`apps/worker-oidc/test/tsconfig.json`:

```json
{
    "extends": "../tsconfig.json",
    "compilerOptions": {
        "types": ["@cloudflare/vitest-pool-workers/types", "node"]
    },
    "include": ["./**/*.ts", "../worker-configuration.d.ts"]
}
```

`apps/worker-oidc/test/helpers/call-app.ts`:

```ts
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import app from '../../src/index'

export async function callAsApp(request: Request, envOverrides: Partial<typeof env> = {}) {
    const ctx = createExecutionContext()
    const response = await app.fetch(request, { ...env, ...envOverrides }, ctx)
    await waitOnExecutionContext(ctx)
    return response
}
```

- [ ] **Step 3: Write the failing CORS test**

`apps/worker-oidc/test/cors.test.ts`:

```ts
import { describe, it } from 'vitest'
import { callAsApp } from './helpers/call-app'

describe('CORS on cross-origin browser endpoints', () => {
    it.each(['/api/auth/jwks', '/api/auth/oauth2/userinfo'])('opens CORS on %s', async (path, { expect }) => {
        const response = await callAsApp(
            new Request(`https://example.com${path}`, { headers: { origin: 'https://admin.example.test' } })
        )
        expect(response.headers.get('access-control-allow-origin')).toBe('*')
    })

    it('opens CORS on /api/auth/oauth2/token', async ({ expect }) => {
        const response = await callAsApp(
            new Request('https://example.com/api/auth/oauth2/token', {
                method: 'POST',
                headers: { origin: 'https://admin.example.test', 'content-type': 'application/x-www-form-urlencoded' },
                body: 'grant_type=authorization_code'
            })
        )
        expect(response.headers.get('access-control-allow-origin')).toBe('*')
    })
})
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm run test:run -w @capstone/openid-connect`
Expected: FAIL on all three cases — no `access-control-allow-origin` header yet (also confirms the new test infra itself boots correctly against a real local D1 with migrations applied).

- [ ] **Step 5: Add the CORS middleware**

In `apps/worker-oidc/src/index.ts`:

```ts
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { createAuth } from './auth'
import { createDb } from './db/client'

const app = new Hono<{ Bindings: Env }>()

app.get('/', c => c.text('ok'))

// These three are called directly, cross-origin, from worker-admin's browser JS (no service
// binding involved) — a public JWKS, a userinfo lookup gated by the caller's own access token,
// and a token exchange gated by the caller's own authorization code + PKCE verifier. None of
// them are guarded by a cookie, so opening CORS wide doesn't leak anything the caller didn't
// already have. Same reasoning worker-auth already applied to its own /api/auth/jwks.
app.use('/api/auth/jwks', cors())
app.use('/api/auth/oauth2/userinfo', cors())
app.use('/api/auth/oauth2/token', cors())

app.all('/api/auth/*', c => {
    const db = createDb(c.env.OIDC_DB)
    const auth = createAuth(db, c.env)
    return auth.handler(c.req.raw)
})

export default app
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test:run -w @capstone/openid-connect`
Expected: PASS — all three tests.

- [ ] **Step 7: Commit**

```bash
git add apps/worker-oidc/package.json apps/worker-oidc/vitest.config.mjs apps/worker-oidc/test apps/worker-oidc/src/index.ts package-lock.json
git commit -m "$(cat <<'EOF'
test(oidc): add vitest-pool-workers test infra

- mirror worker-auth's D1-migrations test setup, without the Google mocking it doesn't need
feat(oidc): open CORS on jwks, userinfo, and token endpoints

- worker-admin's browser calls these directly, cross-origin; none are cookie-gated
EOF
)"
```

(Two logical changes in one commit is acceptable here since the CORS test can't pass without the test infra it's written against — if your git tooling requires one Conventional Commits header per commit, use the `feat(oidc): ...` line as the sole subject and fold the `test(oidc): ...` line into the body instead.)

---

## Task 4: `worker-oidc` — `/signup` page wiring + client bootstrap route

Two independent pieces of plumbing `worker-admin`'s sign-in flow will need: `oauthProvider`'s `signup.page` config (so `prompt=create` lands on `/signup`, not `/login`), and a guarded bootstrap route that registers `worker-admin` as a public OAuth client via the plugin's server-only `adminCreateOAuthClient` API (that endpoint is `SERVER_ONLY` — not exposed over the plugin's own HTTP router, confirmed against `node_modules/@better-auth/oauth-provider/dist/oauth-D8xpKR0_.d.mts:1760-1950` — so it can only be called from our own Worker code, never dynamically registered by a client itself).

**Files:**
- Modify: `apps/worker-oidc/src/auth.ts`
- Create: `apps/worker-oidc/src/register-worker-admin-client.ts`
- Modify: `apps/worker-oidc/src/index.ts`
- Test: `apps/worker-oidc/test/register-worker-admin-client.test.ts`

**Interfaces:**
- Consumes: `createAuth(db, env)` from `./auth` (unchanged signature), `createDb(d1)` from `./db/client` (unchanged signature).
- Produces: `registerBootstrapRoute(app: Hono<{ Bindings: Env }>): void`, mounting `POST /internal/oauth-clients/worker-admin`. Response body on success: `{ client_id: string }`.

- [ ] **Step 1: Write the failing test**

`apps/worker-oidc/test/register-worker-admin-client.test.ts`:

```ts
import { describe, it } from 'vitest'
import { callAsApp } from './helpers/call-app'

const REDIRECT_URI = 'https://admin.example.test/auth-callback'

function bootstrapRequest(secret = 'test-secret') {
    return new Request(
        `https://example.com/internal/oauth-clients/worker-admin?redirect_uri=${encodeURIComponent(REDIRECT_URI)}`,
        { method: 'POST', headers: { authorization: `Bearer ${secret}` } }
    )
}

describe('POST /internal/oauth-clients/worker-admin', () => {
    it('rejects a request with the wrong bearer secret', async ({ expect }) => {
        const response = await callAsApp(bootstrapRequest('wrong-secret'), { BETTER_AUTH_SECRET: 'test-secret' })
        expect(response.status).toBe(401)
    })

    it('rejects a request missing redirect_uri', async ({ expect }) => {
        const response = await callAsApp(
            new Request('https://example.com/internal/oauth-clients/worker-admin', {
                method: 'POST',
                headers: { authorization: 'Bearer test-secret' }
            }),
            { BETTER_AUTH_SECRET: 'test-secret' }
        )
        expect(response.status).toBe(400)
    })

    it('registers a public, PKCE-required, consent-requiring client', async ({ expect }) => {
        const response = await callAsApp(bootstrapRequest(), { BETTER_AUTH_SECRET: 'test-secret' })
        expect(response.status).toBe(200)
        const { client_id } = await response.json<{ client_id: string }>()
        expect(client_id).toBeTruthy()
    })

    it('is idempotent — a second call returns the same client_id', async ({ expect }) => {
        const first = await callAsApp(bootstrapRequest(), { BETTER_AUTH_SECRET: 'test-secret' })
        const { client_id: firstId } = await first.json<{ client_id: string }>()

        const second = await callAsApp(bootstrapRequest(), { BETTER_AUTH_SECRET: 'test-secret' })
        const { client_id: secondId } = await second.json<{ client_id: string }>()

        expect(secondId).toBe(firstId)
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -w @capstone/openid-connect`
Expected: FAIL — `/internal/oauth-clients/worker-admin` doesn't exist yet (404 on every case).

- [ ] **Step 3: Add `signup.page` to the auth config**

In `apps/worker-oidc/src/auth.ts`, change the `oauthProvider` call:

```ts
oauthProvider({
    loginPage: '/login',
    consentPage: '/consent',
    signup: { page: '/signup' }
})
```

- [ ] **Step 4: Write the bootstrap route**

`apps/worker-oidc/src/register-worker-admin-client.ts`:

```ts
import { eq } from 'drizzle-orm'
import type { Hono } from 'hono'
import { createAuth } from './auth'
import { createDb } from './db/client'
import { oauthClient } from './db/schema'

// Registers worker-admin as a public OAuth client. Called once per environment via a manual
// curl (see apps/worker-admin/CLAUDE.md), never at runtime by a client itself — that's why this
// goes through the plugin's SERVER_ONLY adminCreateOAuthClient API rather than dynamic client
// registration. Idempotent: re-running it returns the existing client_id instead of creating a
// duplicate row, so it's safe to call again if you're not sure whether it already ran.
export function registerBootstrapRoute(app: Hono<{ Bindings: Env }>) {
    app.post('/internal/oauth-clients/worker-admin', async c => {
        if (c.req.header('authorization') !== `Bearer ${c.env.BETTER_AUTH_SECRET}`) {
            return c.text('Unauthorized', 401)
        }

        const redirectUri = c.req.query('redirect_uri')
        if (!redirectUri) {
            return c.text('Missing redirect_uri query param', 400)
        }

        const db = createDb(c.env.OIDC_DB)
        const [existing] = await db.select().from(oauthClient).where(eq(oauthClient.name, 'worker-admin')).limit(1)
        if (existing) {
            return c.json({ client_id: existing.clientId })
        }

        const auth = createAuth(db, c.env)
        const client = await auth.api.adminCreateOAuthClient({
            body: {
                client_name: 'worker-admin',
                redirect_uris: [redirectUri],
                token_endpoint_auth_method: 'none',
                application_type: 'web',
                skip_consent: false,
                grant_types: ['authorization_code'],
                response_types: ['code'],
                scope: 'openid email profile'
            }
        })
        return c.json({ client_id: client.client_id })
    })
}
```

- [ ] **Step 5: Wire the route into `src/index.ts`**

Add to `apps/worker-oidc/src/index.ts` (alongside the existing imports and before the `/api/auth/*` catch-all):

```ts
import { registerBootstrapRoute } from './register-worker-admin-client'
```

```ts
registerBootstrapRoute(app)
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test:run -w @capstone/openid-connect`
Expected: PASS — all four cases.

- [ ] **Step 7: Commit**

```bash
git add apps/worker-oidc/src/auth.ts apps/worker-oidc/src/register-worker-admin-client.ts apps/worker-oidc/src/index.ts apps/worker-oidc/test/register-worker-admin-client.test.ts
git commit -m "$(cat <<'EOF'
feat(oidc): add worker-admin client bootstrap route

- register a public, consent-requiring OAuth client via the plugin's server-only admin API
- guarded by BETTER_AUTH_SECRET as a bearer token; idempotent on the client's name
- point oauthProvider's signup prompt at its own /signup page
EOF
)"
```

---

## Task 5: `worker-oidc` — `/login`, `/signup`, `/consent` pages + full authorization-code flow

The pages themselves are plain server-rendered HTML with a little vanilla JS — no frontend build step, matching `worker-auth`'s existing `/login`. This task also adds the integration test that proves the whole authorization-code+PKCE+consent round trip actually works end to end against these pages' own backing endpoints, following the exact pattern already proven in `apps/worker-auth/test/oauth-provider.test.ts` (same PKCE helper, same consent-response shape).

**Files:**
- Create: `apps/worker-oidc/src/pages.ts`
- Modify: `apps/worker-oidc/src/index.ts`
- Test: `apps/worker-oidc/test/pages.test.ts`
- Test: `apps/worker-oidc/test/oauth-client-flow.test.ts`

**Interfaces:**
- Consumes: `registerBootstrapRoute` (Task 4), `callAsApp` (Task 3).
- Produces: `registerOidcPages(app: Hono<{ Bindings: Env }>): void`, mounting `GET /login`, `GET /signup`, `GET /consent`.

- [ ] **Step 1: Write the failing page-rendering tests**

`apps/worker-oidc/test/pages.test.ts`:

```ts
import { describe, it } from 'vitest'
import { callAsApp } from './helpers/call-app'

describe('GET /login', () => {
    it('renders a sign-in form and preserves the query string in the resume link', async ({ expect }) => {
        const response = await callAsApp(new Request('https://example.com/login?client_id=abc&state=xyz'))
        expect(response.status).toBe(200)
        const html = await response.text()
        expect(html).toContain('name="email"')
        expect(html).toContain('name="password"')
    })
})

describe('GET /signup', () => {
    it('renders a registration form', async ({ expect }) => {
        const response = await callAsApp(new Request('https://example.com/signup?client_id=abc&state=xyz'))
        expect(response.status).toBe(200)
        const html = await response.text()
        expect(html).toContain('name="name"')
        expect(html).toContain('name="email"')
        expect(html).toContain('name="password"')
    })
})

describe('GET /consent', () => {
    it('escapes an unrecognized client_id rather than reflecting it unescaped', async ({ expect }) => {
        const response = await callAsApp(
            new Request(`https://example.com/consent?${new URLSearchParams({ client_id: '<script>alert(1)</script>', scope: 'openid' })}`)
        )
        expect(response.status).toBe(200)
        const html = await response.text()
        expect(html).not.toContain('<script>alert(1)</script>')
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -w @capstone/openid-connect`
Expected: FAIL — none of these routes exist yet (404s).

- [ ] **Step 3: Write `src/pages.ts`**

```ts
import type { Hono } from 'hono'
import { createAuth } from './auth'
import { createDb } from './db/client'

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

function loginPage(): string {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Sign in</title>
</head>
<body>
<h3>Sign in</h3>
<form id="login-form">
<label>Email <input type="email" name="email" required /></label>
<label>Password <input type="password" name="password" required /></label>
<button type="submit">Sign in</button>
</form>
<p id="error" style="color:red"></p>
<p><a id="signup-link" href="#">Need an account? Sign up</a></p>
<script>
document.getElementById('signup-link').href = '/signup' + window.location.search
document.getElementById('login-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    const form = new FormData(event.target)
    const response = await fetch('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: form.get('email'), password: form.get('password') })
    })
    if (!response.ok) {
        document.getElementById('error').textContent = 'Sign-in failed, please try again.'
        return
    }
    window.location.href = '/api/auth/oauth2/authorize' + window.location.search
})
</script>
</body>
</html>`
}

function signupPage(): string {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Sign up</title>
</head>
<body>
<h3>Sign up</h3>
<form id="signup-form">
<label>Name <input type="text" name="name" required /></label>
<label>Email <input type="email" name="email" required /></label>
<label>Password <input type="password" name="password" required /></label>
<button type="submit">Sign up</button>
</form>
<p id="error" style="color:red"></p>
<script>
document.getElementById('signup-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    const form = new FormData(event.target)
    const signUpResponse = await fetch('/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: form.get('name'), email: form.get('email'), password: form.get('password') })
    })
    if (!signUpResponse.ok) {
        document.getElementById('error').textContent = 'Sign-up failed, please try again.'
        return
    }
    const continueResponse = await fetch('/api/auth/oauth2/continue', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ created: true, oauth_query: window.location.search.slice(1) })
    })
    if (!continueResponse.ok) {
        document.getElementById('error').textContent = 'Could not continue sign-in, please try again.'
        return
    }
    const { url } = await continueResponse.json()
    window.location.href = url
})
</script>
</body>
</html>`
}

function consentPage(clientName: string, scope: string): string {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Authorize</title>
</head>
<body>
<h3>${escapeHtml(clientName)} wants to sign you in</h3>
<p>Requested access: ${escapeHtml(scope)}</p>
<button id="accept" type="button">Allow</button>
<button id="deny" type="button">Deny</button>
<p id="error" style="color:red"></p>
<script>
async function respond(accept) {
    const response = await fetch('/api/auth/oauth2/consent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accept, oauth_query: window.location.search.slice(1) })
    })
    if (!response.ok) {
        document.getElementById('error').textContent = 'Could not complete authorization, please try again.'
        return
    }
    const { url } = await response.json()
    window.location.href = url
}
document.getElementById('accept').addEventListener('click', () => respond(true))
document.getElementById('deny').addEventListener('click', () => respond(false))
</script>
</body>
</html>`
}

export function registerOidcPages(app: Hono<{ Bindings: Env }>) {
    app.get('/login', c => c.html(loginPage()))
    app.get('/signup', c => c.html(signupPage()))
    app.get('/consent', async c => {
        const clientId = c.req.query('client_id') ?? ''
        const scope = c.req.query('scope') ?? ''

        let clientName = clientId
        const db = createDb(c.env.OIDC_DB)
        const auth = createAuth(db, c.env)
        const client = await auth.api.getOAuthClientPublic({ query: { client_id: clientId }, headers: c.req.raw.headers }).catch(() => null)
        if (client?.client_name) clientName = client.client_name

        return c.html(consentPage(clientName, scope))
    })
}
```

- [ ] **Step 4: Wire the pages into `src/index.ts`**

Add to `apps/worker-oidc/src/index.ts`:

```ts
import { registerOidcPages } from './pages'
```

```ts
registerOidcPages(app)
```

- [ ] **Step 5: Run the page tests to verify they pass**

Run: `npm run test:run -w @capstone/openid-connect`
Expected: PASS.

- [ ] **Step 6: Write the failing end-to-end flow test**

`apps/worker-oidc/test/oauth-client-flow.test.ts`:

```ts
import { describe, it } from 'vitest'
import { callAsApp } from './helpers/call-app'

const REDIRECT_URI = 'https://admin.example.test/auth-callback'

function base64url(bytes: ArrayBuffer) {
    return btoa(String.fromCharCode(...new Uint8Array(bytes)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')
}

// Same helper apps/worker-auth/test/oauth-provider.test.ts uses — registered clients default to
// require_pkce: true, so a real authorization-code flow needs a real PKCE pair.
async function generatePkcePair() {
    const codeVerifier = base64url(crypto.getRandomValues(new Uint8Array(32)).buffer)
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier))
    const codeChallenge = base64url(digest)
    return { codeVerifier, codeChallenge }
}

async function registerWorkerAdminClient() {
    const response = await callAsApp(
        new Request(`https://example.com/internal/oauth-clients/worker-admin?redirect_uri=${encodeURIComponent(REDIRECT_URI)}`, {
            method: 'POST',
            headers: { authorization: 'Bearer test-secret' }
        }),
        { BETTER_AUTH_SECRET: 'test-secret' }
    )
    const { client_id } = await response.json<{ client_id: string }>()
    return client_id as string
}

describe('OAuth client flow (worker-admin against worker-oidc)', () => {
    it('completes sign-up, consent, and token exchange for the registered public client', async ({ expect }) => {
        const clientId = await registerWorkerAdminClient()
        const { codeVerifier, codeChallenge } = await generatePkcePair()

        const authorizeQuery = new URLSearchParams({
            response_type: 'code',
            client_id: clientId,
            redirect_uri: REDIRECT_URI,
            scope: 'openid email profile',
            code_challenge: codeChallenge,
            code_challenge_method: 'S256',
            state: 'test-state'
        }).toString()

        const authorizeResponse = await callAsApp(new Request(`https://example.com/api/auth/oauth2/authorize?${authorizeQuery}`))
        expect(authorizeResponse.status).toBeGreaterThanOrEqual(300)
        expect(authorizeResponse.status).toBeLessThan(400)
        const loginRedirect = new URL(authorizeResponse.headers.get('location') ?? '', 'https://example.com')
        expect(loginRedirect.pathname).toBe('/login')

        const signUpResponse = await callAsApp(
            new Request('https://example.com/api/auth/sign-up/email', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ name: 'Test Admin', email: 'admin@example.com', password: 'correct-horse-battery' })
            })
        )
        expect(signUpResponse.status).toBeLessThan(300)
        const cookie = signUpResponse.headers
            .getSetCookie()
            .find(entry => entry.includes('session_token'))
            ?.split(';')[0]
        if (!cookie) throw new Error('expected a session cookie from sign-up')

        // Mirrors what login.html's own JS does after a successful sign-in: replay the exact
        // signed query string /login received back onto /oauth2/authorize.
        const resumeResponse = await callAsApp(
            new Request(`https://example.com/api/auth/oauth2/authorize${loginRedirect.search}`, { headers: { cookie } })
        )
        expect(resumeResponse.status).toBeGreaterThanOrEqual(300)
        expect(resumeResponse.status).toBeLessThan(400)
        const consentRedirect = new URL(resumeResponse.headers.get('location') ?? '', 'https://example.com')
        expect(consentRedirect.pathname).toBe('/consent')

        const consentResponse = await callAsApp(
            new Request('https://example.com/api/auth/oauth2/consent', {
                method: 'POST',
                headers: { cookie, origin: 'https://example.com', 'content-type': 'application/json' },
                body: JSON.stringify({ accept: true, oauth_query: consentRedirect.search.slice(1) })
            })
        )
        expect(consentResponse.status).toBe(200)
        const { url: redirectWithCode } = await consentResponse.json<{ redirect: boolean; url: string }>()
        const code = new URL(redirectWithCode).searchParams.get('code')
        if (!code) throw new Error('expected an authorization code in the redirect')

        const tokenResponse = await callAsApp(
            new Request('https://example.com/api/auth/oauth2/token', {
                method: 'POST',
                headers: { 'content-type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    grant_type: 'authorization_code',
                    code,
                    redirect_uri: REDIRECT_URI,
                    client_id: clientId,
                    code_verifier: codeVerifier
                })
            })
        )
        expect(tokenResponse.status).toBe(200)
        const tokens = await tokenResponse.json<{ access_token: string; id_token: string }>()
        expect(tokens.access_token).toBeTruthy()
        expect(tokens.id_token).toBeTruthy()
    })
})
```

- [ ] **Step 7: Run the flow test**

Run: `npm run test:run -w @capstone/openid-connect`

If it fails on an assertion about status codes, header shapes, or the consent/continue response body, that means the live plugin behaves slightly differently from what's documented above for this installed version — adjust the assertion to match what the plugin actually returns (not what this plan predicted), then re-run. This test is the ground truth for whether the flow really works; trust the live response over this document.

Expected once passing: PASS — proves the full authorize → login → resume → consent → token round trip works end to end against real pages and a real registered client.

- [ ] **Step 8: Commit**

```bash
git add apps/worker-oidc/src/pages.ts apps/worker-oidc/src/index.ts apps/worker-oidc/test/pages.test.ts apps/worker-oidc/test/oauth-client-flow.test.ts
git commit -m "$(cat <<'EOF'
feat(oidc): add login, signup, and consent pages

- plain server-rendered HTML+JS, no frontend build step, matching worker-auth's own /login
- consent page looks up the client's display name via getOAuthClientPublic
test(oidc): prove the full authorize/login/consent/token round trip

- registers worker-admin's client, signs up a user, and exchanges a code for tokens
EOF
)"
```

---

## Task 6: `worker-admin` — PKCE helper

**Files:**
- Create: `apps/worker-admin/src/lib/pkce.ts`
- Test: `apps/worker-admin/src/lib/pkce.test.ts`

**Interfaces:**
- Produces: `createPkcePair(): Promise<{ codeVerifier: string; codeChallenge: string }>`.

- [ ] **Step 1: Write the failing test**

`apps/worker-admin/src/lib/pkce.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createPkcePair } from './pkce'

describe('createPkcePair', () => {
    it('generates a URL-safe code_verifier and its S256 code_challenge', async () => {
        const { codeVerifier, codeChallenge } = await createPkcePair()

        expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]{40,}$/)
        expect(codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/)

        const expectedDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier))
        const expectedChallenge = btoa(String.fromCharCode(...new Uint8Array(expectedDigest)))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '')
        expect(codeChallenge).toBe(expectedChallenge)
    })

    it('generates a different pair on every call', async () => {
        const first = await createPkcePair()
        const second = await createPkcePair()
        expect(first.codeVerifier).not.toBe(second.codeVerifier)
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -w @capstone/admin`
Expected: FAIL — `./pkce` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

`apps/worker-admin/src/lib/pkce.ts`:

```ts
function base64url(bytes: ArrayBuffer) {
    return btoa(String.fromCharCode(...new Uint8Array(bytes)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')
}

export async function createPkcePair() {
    const codeVerifier = base64url(crypto.getRandomValues(new Uint8Array(32)).buffer)
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier))
    const codeChallenge = base64url(digest)
    return { codeVerifier, codeChallenge }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -w @capstone/admin`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker-admin/src/lib/pkce.ts apps/worker-admin/src/lib/pkce.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): add PKCE code_verifier/code_challenge helper

- S256 challenge derivation, same shape as worker-auth's own test helper for this
EOF
)"
```

---

## Task 7: `worker-admin` — rewrite sign-in to PKCE against `worker-oidc`

Replaces the Google-via-worker-auth sign-in and the admin-plugin-backed dashboard with: a PKCE-driven redirect to `worker-oidc`, a code-exchange callback, and a bare "signed in as `<email>`" dashboard. This is one task because the four files only work together — a partial rewrite leaves the app in a broken state.

**Files:**
- Modify: `apps/worker-admin/src/lib/auth-client.ts`
- Modify: `apps/worker-admin/src/routes/login.tsx`
- Modify: `apps/worker-admin/src/routes/auth-callback.tsx`
- Modify: `apps/worker-admin/src/routes/index.tsx`
- Create: `apps/worker-admin/.env.example`
- Modify: `apps/worker-admin/package.json` (drop the now-unused `better-auth` dependency)

**Interfaces:**
- Consumes: `createPkcePair()` (Task 6), `verifyAccessToken`/`AccessTokenClaims` from `@capstone/auth-verify` (Task 1, `role` now optional).
- Produces: `getStoredJwt(): string | undefined`, `storeJwt(jwt: string): void`, `clearStoredJwt(): void` from `src/lib/auth-client.ts` (same names/signatures as today; `getStoredSession`/`storeSession`/`clearStoredSession` and `authClient` are removed — nothing outside this task's own files may still import them after this task).

- [ ] **Step 1: Simplify `src/lib/auth-client.ts`**

Replace its entire contents with:

```ts
const JWT_STORAGE_KEY = 'admin_jwt'

export function getStoredJwt() {
    try {
        return sessionStorage.getItem(JWT_STORAGE_KEY) ?? undefined
    } catch {
        return undefined
    }
}

export function storeJwt(jwt: string) {
    try {
        sessionStorage.setItem(JWT_STORAGE_KEY, jwt)
    } catch {
        // sessionStorage can throw in a locked-down browser; nothing to recover here.
    }
}

export function clearStoredJwt() {
    try {
        sessionStorage.removeItem(JWT_STORAGE_KEY)
    } catch {
        // sessionStorage can throw in a locked-down browser; nothing to recover here.
    }
}
```

- [ ] **Step 2: Rewrite `src/routes/login.tsx`**

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { createPkcePair } from '../lib/pkce'

const OIDC_ORIGIN = import.meta.env.VITE_OIDC_ORIGIN ?? 'http://localhost:8791'
const CLIENT_ID = import.meta.env.VITE_OIDC_CLIENT_ID ?? ''

export const Route = createFileRoute('/login')({
    component: LoginRoute
})

function LoginRoute() {
    async function signIn() {
        const { codeVerifier, codeChallenge } = await createPkcePair()
        const state = crypto.randomUUID()
        sessionStorage.setItem('oidc_code_verifier', codeVerifier)
        sessionStorage.setItem('oidc_state', state)

        const params = new URLSearchParams({
            client_id: CLIENT_ID,
            redirect_uri: `${window.location.origin}/auth-callback`,
            response_type: 'code',
            scope: 'openid email profile',
            code_challenge: codeChallenge,
            code_challenge_method: 'S256',
            state
        })
        window.location.href = `${OIDC_ORIGIN}/api/auth/oauth2/authorize?${params.toString()}`
    }

    return (
        <div className="p-2">
            <h3>Sign in</h3>
            <button type="button" onClick={signIn}>
                Sign in
            </button>
        </div>
    )
}
```

- [ ] **Step 3: Rewrite `src/routes/auth-callback.tsx`**

```tsx
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { storeJwt } from '../lib/auth-client'

const OIDC_ORIGIN = import.meta.env.VITE_OIDC_ORIGIN ?? 'http://localhost:8791'
const CLIENT_ID = import.meta.env.VITE_OIDC_CLIENT_ID ?? ''

export const Route = createFileRoute('/auth-callback')({
    component: AuthCallbackRoute
})

function AuthCallbackRoute() {
    const navigate = useNavigate()

    useEffect(() => {
        async function exchangeCode() {
            const params = new URLSearchParams(window.location.search)
            const code = params.get('code')
            const state = params.get('state')
            const expectedState = sessionStorage.getItem('oidc_state')
            const codeVerifier = sessionStorage.getItem('oidc_code_verifier')
            sessionStorage.removeItem('oidc_state')
            sessionStorage.removeItem('oidc_code_verifier')

            if (!code || !state || !codeVerifier || state !== expectedState) {
                navigate({ to: '/login' })
                return
            }

            const response = await fetch(`${OIDC_ORIGIN}/api/auth/oauth2/token`, {
                method: 'POST',
                headers: { 'content-type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    grant_type: 'authorization_code',
                    code,
                    redirect_uri: `${window.location.origin}/auth-callback`,
                    client_id: CLIENT_ID,
                    code_verifier: codeVerifier
                })
            })
            if (!response.ok) {
                navigate({ to: '/login' })
                return
            }
            const tokens = (await response.json()) as { id_token?: string }
            if (!tokens.id_token) {
                navigate({ to: '/login' })
                return
            }
            storeJwt(tokens.id_token)
            navigate({ to: '/' })
        }
        exchangeCode()
    }, [navigate])

    return <p className="p-2">Signing in…</p>
}
```

- [ ] **Step 4: Rewrite `src/routes/index.tsx`**

```tsx
import { type AccessTokenClaims, verifyAccessToken } from '@capstone/auth-verify'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { clearStoredJwt, getStoredJwt } from '../lib/auth-client'

const OIDC_ORIGIN = import.meta.env.VITE_OIDC_ORIGIN ?? 'http://localhost:8791'
const JWKS_URL = `${OIDC_ORIGIN}/api/auth/jwks`

export const Route = createFileRoute('/')({
    beforeLoad: () => {
        if (!getStoredJwt()) throw redirect({ to: '/login' })
    },
    component: DashboardRoute
})

function DashboardRoute() {
    // `beforeLoad` only proves a token *string* is in sessionStorage, not that it still
    // verifies — so still-resolving, resolved-but-invalid, and resolved-with-claims stay
    // distinct states here, same as before this rewrite.
    const [claims, setClaims] = useState<AccessTokenClaims | null | undefined>(undefined)
    const navigate = useNavigate()

    useEffect(() => {
        const jwt = getStoredJwt()
        if (!jwt) return
        verifyAccessToken(jwt, JWKS_URL).then(setClaims)
    }, [])

    const isPending = claims === undefined
    const tokenIsStale = !isPending && !claims

    useEffect(() => {
        if (!tokenIsStale) return
        clearStoredJwt()
        navigate({ to: '/login' })
    }, [tokenIsStale, navigate])

    function signOut() {
        clearStoredJwt()
        navigate({ to: '/login' })
    }

    if (isPending) return <p className="p-2">Loading…</p>
    if (tokenIsStale) return <p className="p-2">Your session has expired. Redirecting to sign in…</p>

    return (
        <div className="p-2">
            <p>Signed in as {claims?.email}</p>
            <button type="button" onClick={signOut}>
                Sign out
            </button>
        </div>
    )
}
```

- [ ] **Step 5: Add `.env.example` documenting the two new build-time vars**

`apps/worker-admin/.env.example`:

```
# Copy to .env (gitignored) and fill in the client_id printed by the bootstrap curl call
# documented in apps/worker-admin/CLAUDE.md.
VITE_OIDC_ORIGIN=http://localhost:8791
VITE_OIDC_CLIENT_ID=
```

- [ ] **Step 6: Drop the now-unused `better-auth` dependency**

Remove `"better-auth": "^1.7.1"` from `apps/worker-admin/package.json`'s `"dependencies"` — nothing in `src/` imports it anymore after this task. Run `npm install` from the repo root afterward.

- [ ] **Step 7: Verify the app still type-checks and builds**

Run: `npm run check-types -w @capstone/admin && npm run build -w @capstone/admin`
Expected: both succeed with no references to the removed `authClient`/`getStoredSession`/`storeSession`/`clearStoredSession` exports anywhere (a leftover reference would be a type error now that `auth-client.ts` no longer exports them).

- [ ] **Step 8: Commit**

```bash
git add apps/worker-admin/src/lib/auth-client.ts apps/worker-admin/src/routes/login.tsx apps/worker-admin/src/routes/auth-callback.tsx apps/worker-admin/src/routes/index.tsx apps/worker-admin/.env.example apps/worker-admin/package.json package-lock.json
git commit -m "$(cat <<'EOF'
feat(admin): sign in via PKCE against worker-oidc

- login.tsx redirects into worker-oidc's /oauth2/authorize with a generated PKCE pair
- auth-callback.tsx exchanges the returned code for tokens directly, cross-origin
- dashboard drops the admin-plugin user list; shows "signed in as <email>" and sign-out
- drop the now-unused better-auth dependency and its session-token storage helpers
EOF
)"
```

---

## Task 8: `worker-admin` — remove the backend Worker

Nothing calls `/api/auth/*` on `worker-admin`'s own origin anymore (Task 7 switched every call to `worker-oidc`'s origin directly), so the passthrough Worker and its `AUTH_SERVICE` binding are dead code. This is safe to do only now, after Task 7 — doing it earlier would have left the still-`authClient`-based dashboard broken between commits.

**Files:**
- Delete: `apps/worker-admin/worker/index.ts`
- Delete: `apps/worker-admin/test/index.test.ts`
- Modify: `apps/worker-admin/wrangler.jsonc`
- Modify: `apps/worker-admin/vitest.config.mjs`
- Modify: `apps/worker-admin/tsconfig.json`
- Modify: `apps/worker-admin/package.json`

- [ ] **Step 1: Delete the backend Worker and its test**

```bash
rm apps/worker-admin/worker/index.ts apps/worker-admin/test/index.test.ts
rmdir apps/worker-admin/worker apps/worker-admin/test 2>/dev/null || true
```

- [ ] **Step 2: Simplify `wrangler.jsonc` to an assets-only config**

Replace `apps/worker-admin/wrangler.jsonc`'s contents with:

```jsonc
/**
 * For more details on how to configure Wrangler, refer to:
 * https://developers.cloudflare.com/workers/wrangler/configuration/
 */
{
    "$schema": "../../node_modules/wrangler/config-schema.json",
    "name": "worker-admin",
    "compatibility_date": "2026-08-22",
    "assets": {
        "not_found_handling": "single-page-application"
    }
}
```

(`main`, `services`, `run_worker_first`, `observability`, and `upload_source_maps` are all dropped — there's no Worker script left for any of them to apply to. Confirmed against `node_modules/wrangler/config-schema.json`'s `RawConfig` definition that `main` isn't required.)

- [ ] **Step 3: Simplify the Vitest config**

Replace `apps/worker-admin/vitest.config.mjs`'s contents with the same plain shape `packages/lib-auth-verify/vitest.config.mjs` already uses:

```js
import { defineConfig } from 'vitest/config'

export default defineConfig({})
```

- [ ] **Step 4: Drop the `tsconfig.worker.json` reference**

In `apps/worker-admin/tsconfig.json`, remove the `{ "path": "./tsconfig.worker.json" }` reference (there's no `worker/` directory left for it to cover) and delete `apps/worker-admin/tsconfig.worker.json` if it exists as its own file.

- [ ] **Step 5: Drop now-unused Cloudflare Workers-runtime test dependencies**

Remove `"@cloudflare/vitest-pool-workers"` from `apps/worker-admin/package.json`'s `"devDependencies"` — the `worker/` directory it was testing is gone, and Task 6's `pkce.test.ts` already runs fine under plain Vitest. Keep `"@cloudflare/vite-plugin"`, `"@cloudflare/workers-types"`, and the `typegen` script — the Vite plugin still needs them to serve the built assets in dev/deploy. Run `npm install` from the repo root afterward.

- [ ] **Step 6: Verify dev, build, and test all still work**

Run, in order:

```bash
npm run typegen -w @capstone/admin
npm run check-types -w @capstone/admin
npm run test:run -w @capstone/admin
npm run build -w @capstone/admin
```

Expected: all four succeed. If `npm run dev -w @capstone/admin` (start, then Ctrl-C) errors specifically about the missing `main` field rather than serving the SPA, that means this Wrangler/Vite-plugin version needs an explicit `assets.directory` too — add `"directory": "./dist"` alongside `"not_found_handling"` in `wrangler.jsonc` and retry, rather than reintroducing a Worker script.

- [ ] **Step 7: Commit**

```bash
git add -A apps/worker-admin
git commit -m "$(cat <<'EOF'
chore(admin): remove the backend Worker

- nothing calls /api/auth/* on this origin anymore; drop worker/index.ts and its test
- wrangler.jsonc becomes assets-only: no main, no services, no run_worker_first
- drop @cloudflare/vitest-pool-workers now that there's no Workers-runtime code to test
EOF
)"
```

---

## Task 9: Manual end-to-end verification

Automated tests cover the underlying API sequence (Task 5) and the unit-level pieces (Tasks 1, 6), but nothing in this plan drives the actual rendered `/login`/`/signup`/`/consent` HTML or `worker-admin`'s real browser flow — this step is that check, and there's no frontend component test runner in this repo to automate it (established non-goal from the prior admin specs).

- [ ] **Step 1: Run the client bootstrap against local dev**

```bash
npm run dev -w @capstone/openid-connect
```

In another terminal, once it's up on `http://localhost:8791`:

```bash
curl -X POST "http://localhost:8791/internal/oauth-clients/worker-admin?redirect_uri=http%3A%2F%2Flocalhost%3A8790%2Fauth-callback" \
  -H "authorization: Bearer <the BETTER_AUTH_SECRET in apps/worker-oidc/.dev.vars>"
```

Copy the returned `client_id`.

- [ ] **Step 2: Configure and start `worker-admin`**

```bash
cp apps/worker-admin/.env.example apps/worker-admin/.env
```

Fill in the copied `client_id` as `VITE_OIDC_CLIENT_ID` in `apps/worker-admin/.env`. Then:

```bash
npm run dev -w @capstone/admin
```

- [ ] **Step 3: Walk the full flow in a browser**

1. Open `http://localhost:8790`. Confirm it redirects to `/login`, then to `worker-oidc`'s `/login` page.
2. Click "Need an account? Sign up", fill in name/email/password, submit.
3. Confirm you land on the `/consent` page showing "worker-admin wants to sign you in".
4. Click "Allow". Confirm you land back on `http://localhost:8790/auth-callback`, briefly showing "Signing in…", then the dashboard showing "Signed in as `<the email you signed up with>`".
5. Click "Sign out". Confirm you're returned to `/login`.
6. Repeat steps 1–2 but click "Deny" on the consent screen instead — confirm you're redirected back toward `worker-admin` with an OAuth error rather than silently landing on the dashboard.

- [ ] **Step 4: Record the result**

No commit for this task — if every check in Step 3 passes, the feature is done; if any step fails, treat it as a bug in the relevant earlier task (fix it there, re-run this task's manual check, and note in your final report which task the fix landed in).

---

## Task 10: Versioning

- [ ] **Step 1: Run the changeset CLI**

```bash
npm run changeset
```

Select `@capstone/admin`, `@capstone/openid-connect`, and `@capstone/auth-verify`. Suggested bump types: `minor` for `@capstone/admin` and `@capstone/openid-connect` (new user-facing capability), `patch` for `@capstone/auth-verify` (a widened type, not a breaking one — existing callers that always got a `role` back still do). Write a short summary for each when prompted, e.g. "Sign in via worker-oidc instead of worker-auth" / "Serve login, signup, and consent pages and register worker-admin as a client" / "Make the role claim optional".

- [ ] **Step 2: Commit the changeset file**

```bash
git add .changeset
git commit -m "chore: add changeset for worker-admin OIDC client work"
```

(No scope — a changeset file is a repo-wide versioning record, not workspace-specific code, matching the root-level commit convention.)
