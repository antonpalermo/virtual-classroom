# Auth Worker (Google Sign-In + OAuth Provider) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up `apps/worker-auth`, a new Cloudflare Worker that owns all user identity: Google sign-in/sign-up via Better Auth, and its own OAuth 2.1 provider capability so future applications can link in against a single identity source of truth.

**Architecture:** A Hono app mounts Better Auth's handler at `/api/auth/*`. Better Auth is backed by D1 (binding `AUTH_DB`) via a Drizzle adapter, configured with Google as the only social provider plus the `oauthProvider`/`jwt` plugin pair that turns this worker into its own OAuth issuer. Every behavior is driven by a failing Vitest test first (`@cloudflare/vitest-pool-workers`, running inside the real Workers runtime against a real local D1), with outbound calls to Google mocked via `@msw/cloudflare` so the full sign-in/callback code path is exercised deterministically without a real Google account.

**Tech Stack:** Hono, Better Auth (`better-auth`, `@better-auth/oauth-provider`), Drizzle ORM (`drizzle-orm/d1`, `drizzle-kit`), Cloudflare D1, Vitest + `@cloudflare/vitest-pool-workers`, `msw` + `@msw/cloudflare`.

**Spec:** [docs/superpowers/specs/2026-08-26-auth-worker-design.md](../specs/2026-08-26-auth-worker-design.md)

## Global Constraints

- New Worker `apps/worker-auth` (package name `@capstone/auth`) owns `AUTH_DB` exclusively — no other workspace ever queries it directly; everything goes through `/api/auth/*`.
- D1 binding name: `AUTH_DB`. Drizzle adapter provider: `"sqlite"`.
- `wrangler.jsonc` must include the `nodejs_compat` compatibility flag — Better Auth requires `AsyncLocalStorage`.
- Google is the only configured `socialProviders` entry this pass. No email/password, no other social providers.
- The "link a new application" capability comes from the `oauthProvider` plugin (package `@better-auth/oauth-provider`), which requires the `jwt` plugin (`better-auth/plugins`) alongside it.
- `user.role` is a single additional `text` field, default `'user'`, `input: false` (not settable by the user themselves). No enforcement, no admin UI — placeholder only per spec.
- No sign-in/consent UI is built. Every flow this plan tests uses an already-authenticated session and a client registered with `skip_consent: true`.
- TDD throughout: every task's behavior gets a failing automated test before the code that makes it pass.
- Formatting: Biome, repo-root config (4-space indent, single quotes, no semicolons, no trailing commas) — `apps/worker-auth`'s own `lint` script is `biome check .`, same as `worker-realtime`.
- `tsconfig.json` extends `@capstone/typescript/configs/tsconfig.worker.json`.
- Workspace layout mirrors `apps/worker-realtime`: own `package.json`, `wrangler.jsonc`, `tsconfig.json`, `CLAUDE.md`.

---

### Task 1: Workspace scaffold + Vitest harness boot test

**Files:**
- Create: `apps/worker-auth/package.json`
- Create: `apps/worker-auth/wrangler.jsonc`
- Create: `apps/worker-auth/tsconfig.json`
- Create: `apps/worker-auth/vitest.config.ts`
- Create: `apps/worker-auth/test/tsconfig.json`
- Create: `apps/worker-auth/src/index.ts`
- Test: `apps/worker-auth/test/index.test.ts`

**Interfaces:**
- Produces: a default-exported Hono instance `app` from `src/index.ts` (`Hono<{ Bindings: Env }>`). Every later task imports this as `import app from '../src/index'` and calls `app.fetch(request, env, ctx)`.

No test runner exists in the repo yet, so this task's first few steps are environment setup (not "implementation" in the TDD sense) — the actual `src/index.ts` code is still written only after its test fails first.

- [ ] **Step 1: Scaffold package.json, wrangler.jsonc, tsconfig.json**

`apps/worker-auth/package.json`:
```json
{
    "name": "@capstone/auth",
    "version": "0.0.0",
    "private": true,
    "scripts": {
        "deploy": "wrangler deploy",
        "dev": "wrangler dev",
        "start": "wrangler dev",
        "typegen": "wrangler types",
        "lint": "biome check .",
        "test": "vitest",
        "test:run": "vitest run"
    },
    "dependencies": {
        "hono": "^4.13.5"
    },
    "devDependencies": {
        "@capstone/typescript": "*",
        "@cloudflare/vitest-pool-workers": "^0.22.0",
        "@cloudflare/workers-types": "^5.20260826.1",
        "@types/node": "^24.13.3",
        "typescript": "^7.0.2",
        "vitest": "^4.1.11",
        "wrangler": "^4.126.0"
    }
}
```

`apps/worker-auth/wrangler.jsonc`:
```jsonc
{
    "$schema": "../../node_modules/wrangler/config-schema.json",
    "name": "worker-auth",
    "main": "src/index.ts",
    "compatibility_date": "2026-08-26",
    "compatibility_flags": ["nodejs_compat"],
    "observability": {
        "enabled": true
    },
    "upload_source_maps": true
}
```

`apps/worker-auth/tsconfig.json`:
```json
{
    "extends": "@capstone/typescript/configs/tsconfig.worker.json",
    "compilerOptions": {
        "types": ["./worker-configuration.d.ts", "node"]
    },
    "exclude": ["node_modules"]
}
```

Run from repo root: `npm install` (picks up the new workspace), then `npm run typegen -w @capstone/auth` to generate `apps/worker-auth/worker-configuration.d.ts` (needed for the `Env` type referenced below).

- [ ] **Step 2: Add the Vitest harness config**

`apps/worker-auth/vitest.config.ts`:
```ts
import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
    plugins: [
        cloudflareTest({
            wrangler: { configPath: './wrangler.jsonc' }
        })
    ]
})
```

`apps/worker-auth/test/tsconfig.json`:
```json
{
    "extends": "../tsconfig.json",
    "compilerOptions": {
        "types": ["@cloudflare/vitest-pool-workers/types", "node"]
    },
    "include": ["./**/*.ts", "../worker-configuration.d.ts"]
}
```

> Note: `@cloudflare/vitest-pool-workers` 0.22.0 uses a Vite-plugin-based config (`cloudflareTest()` + `defineConfig`/`defineProject` from `vitest/config`), not the older `defineWorkersConfig` shape some older docs describe — confirmed against the package's actual `exports` field and the current upstream example fixtures, since that older API no longer exists in the published package.

- [ ] **Step 3: Write the failing test**

`apps/worker-auth/test/index.test.ts`:
```ts
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { it } from 'vitest'
import app from '../src/index'

it('responds 200 on GET /', async ({ expect }) => {
    const ctx = createExecutionContext()
    const response = await app.fetch(new Request('https://example.com/'), env, ctx)
    await waitOnExecutionContext(ctx)

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('ok')
})
```

- [ ] **Step 4: Run test to verify it fails**

Run (from `apps/worker-auth`): `npx vitest run`
Expected: FAIL — `src/index.ts` doesn't exist yet (module resolution error).

- [ ] **Step 5: Write minimal implementation**

`apps/worker-auth/src/index.ts`:
```ts
import { Hono } from 'hono'

const app = new Hono<{ Bindings: Env }>()

app.get('/', c => c.text('ok'))

export default app
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/worker-auth package.json package-lock.json
git commit -m "$(cat <<'EOF'
feat(auth): scaffold worker-auth workspace with a Vitest harness

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: D1 + Drizzle + Better Auth core config, mounted at `/api/auth/*`

**Files:**
- Modify: `apps/worker-auth/package.json` (add `better-auth`, `@better-auth/oauth-provider`, `drizzle-orm`, `drizzle-kit`)
- Modify: `apps/worker-auth/wrangler.jsonc` (add `d1_databases` binding)
- Create: `apps/worker-auth/.dev.vars.example`
- Create: `apps/worker-auth/drizzle.config.ts`
- Create: `apps/worker-auth/src/db/client.ts`
- Create: `apps/worker-auth/auth.cli.ts` (Node-only shim, see Step 8)
- Create: `apps/worker-auth/src/auth.ts`
- Create: `apps/worker-auth/src/db/schema.ts` (generated, then owned — see Step 9)
- Create: `apps/worker-auth/drizzle/*.sql` (generated — see Step 10)
- Modify: `apps/worker-auth/src/index.ts` (mount the auth handler)
- Modify: `apps/worker-auth/vitest.config.ts` (apply D1 migrations to the test database)
- Create: `apps/worker-auth/test/env.d.ts`
- Create: `apps/worker-auth/test/apply-migrations.ts`
- Test: `apps/worker-auth/test/auth-ok.test.ts`

**Interfaces:**
- Consumes: `app` from Task 1.
- Produces: `createDb(d1: D1Database)` from `src/db/client.ts` (returns a `DrizzleD1Database`), and `createAuth(db, env: Env)` from `src/auth.ts` (returns a Better Auth instance). Both are factories — not module-level singletons — because a D1 binding only exists inside `c.env` for a given request, not at module load time. Later tasks call `createAuth(db, env)` themselves wherever they need `auth.api.*`.

Better Auth's own CLI (`npx auth@latest generate`) runs under plain Node.js, which cannot see a real D1 binding (that only exists inside the Workers runtime). `auth.cli.ts` (Step 8) is a small Node-only shim that calls the same `createAuth` factory with a placeholder `D1Database` object, purely so the CLI can statically read the configured plugins/fields and emit a matching Drizzle schema — it's never imported by the real Worker.

- [ ] **Step 1: Write the failing test**

`apps/worker-auth/test/auth-ok.test.ts`:
```ts
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { it } from 'vitest'
import app from '../src/index'

it('GET /api/auth/ok returns status ok once Better Auth is mounted and migrated', async ({ expect }) => {
    const ctx = createExecutionContext()
    const response = await app.fetch(new Request('https://example.com/api/auth/ok'), env, ctx)
    await waitOnExecutionContext(ctx)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run`
Expected: FAIL — `/api/auth/*` isn't mounted yet (404), and `AUTH_DB` isn't bound.

- [ ] **Step 3: Add dependencies**

Add to `apps/worker-auth/package.json` `dependencies`: `"better-auth": "^1.7.1"`, `"@better-auth/oauth-provider": "^1.7.1"`, `"drizzle-orm": "^0.45.2"`. Add to `devDependencies`: `"drizzle-kit": "^0.31.10"`.

Run: `npm install` from repo root.

- [ ] **Step 4: Add the D1 binding**

In `apps/worker-auth/wrangler.jsonc`, add after `"compatibility_flags"`:
```jsonc
    "d1_databases": [
        {
            "binding": "AUTH_DB",
            "database_name": "worker-auth",
            "database_id": "00000000-0000-0000-0000-000000000000",
            "migrations_dir": "drizzle"
        }
    ],
```
`database_id` is a placeholder — it's only real once a real D1 database is created with `wrangler d1 create worker-auth`, which is a deployment-time step out of scope for this plan (local dev and the test suite both work fine against the placeholder, since neither talks to a real remote D1).

Run: `npm run typegen -w @capstone/auth` to pick up `AUTH_DB` in the generated `Env` type.

- [ ] **Step 5: Add local secrets**

`apps/worker-auth/.dev.vars.example`:
```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
BETTER_AUTH_SECRET=
BETTER_AUTH_URL=http://localhost:8787
```

Copy it locally (not committed — already covered by the repo's `.dev.vars*` gitignore rule):
```bash
cp apps/worker-auth/.dev.vars.example apps/worker-auth/.dev.vars
```
Fill in `BETTER_AUTH_SECRET` with any 32+ character string (e.g. `openssl rand -base64 32`) and, for now, placeholder values for `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (this task and Task 3's automated tests never call real Google — a real Google Cloud OAuth client is only needed for the manual browser check in Task 3).

- [ ] **Step 6: Create the Drizzle D1 client factory**

`apps/worker-auth/src/db/client.ts`:
```ts
import { drizzle } from 'drizzle-orm/d1'
import * as schema from './schema'

export function createDb(d1: D1Database) {
    return drizzle(d1, { schema })
}

export type Db = ReturnType<typeof createDb>
```

- [ ] **Step 7: Create the Better Auth factory**

`apps/worker-auth/src/auth.ts`:
```ts
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import type { Db } from './db/client'

export function createAuth(db: Db, env: Env) {
    return betterAuth({
        baseURL: env.BETTER_AUTH_URL,
        secret: env.BETTER_AUTH_SECRET,
        database: drizzleAdapter(db, { provider: 'sqlite' }),
        socialProviders: {
            google: {
                clientId: env.GOOGLE_CLIENT_ID,
                clientSecret: env.GOOGLE_CLIENT_SECRET
            }
        },
        user: {
            additionalFields: {
                role: {
                    type: 'string',
                    required: false,
                    defaultValue: 'user',
                    input: false
                }
            }
        },
        // 'https://example.com' matches the origin the test suite's synthetic requests use.
        trustedOrigins: [env.BETTER_AUTH_URL, 'https://example.com']
    })
}
```

- [ ] **Step 8: Create the CLI-only schema-generation shim**

`apps/worker-auth/auth.cli.ts`:
```ts
// Used only by `npx auth@latest generate` to produce src/db/schema.ts.
// The CLI runs under plain Node.js and has no real D1 binding available,
// so this constructs `createAuth` with a placeholder database — schema
// generation only reads the configured plugins/fields, it never queries.
// Never imported by the real Worker (see src/index.ts).
import { drizzle } from 'drizzle-orm/d1'
import { createAuth } from './src/auth'

const placeholderD1 = {} as D1Database
const db = drizzle(placeholderD1)

export const auth = createAuth(db, {
    BETTER_AUTH_URL: 'http://localhost:8787',
    BETTER_AUTH_SECRET: 'cli-schema-generation-placeholder-secret-value-32',
    GOOGLE_CLIENT_ID: 'cli-placeholder',
    GOOGLE_CLIENT_SECRET: 'cli-placeholder'
} as Env)
```

`apps/worker-auth/drizzle.config.ts`:
```ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
    schema: './src/db/schema.ts',
    out: './drizzle',
    dialect: 'sqlite'
})
```

- [ ] **Step 9: Generate the Drizzle schema**

Run (from `apps/worker-auth`):
```bash
npx auth@latest generate --config ./auth.cli.ts --adapter drizzle --dialect sqlite --output src/db/schema.ts
```
This produces `src/db/schema.ts` with Better Auth's core tables (`user`, `session`, `account`, `verification`) plus the `role` additional field. Commit the generated file as-is — it's owned/hand-edited from here per the spec, same as `worker-realtime` owns its DO storage.

- [ ] **Step 10: Generate the SQL migration**

Run: `npx drizzle-kit generate`
This writes the first migration file to `apps/worker-auth/drizzle/0000_*.sql`.

- [ ] **Step 11: Mount the auth handler**

`apps/worker-auth/src/index.ts`:
```ts
import { Hono } from 'hono'
import { createAuth } from './auth'
import { createDb } from './db/client'

const app = new Hono<{ Bindings: Env }>()

app.get('/', c => c.text('ok'))

app.all('/api/auth/*', c => {
    const db = createDb(c.env.AUTH_DB)
    const auth = createAuth(db, c.env)
    return auth.handler(c.req.raw)
})

export default app
```

- [ ] **Step 12: Wire D1 migrations into the test harness**

`apps/worker-auth/test/env.d.ts`:
```ts
declare namespace Cloudflare {
    interface Env {
        TEST_MIGRATIONS: import('cloudflare:test').D1Migration[]
    }
}
```

`apps/worker-auth/test/apply-migrations.ts`:
```ts
import { applyD1Migrations } from 'cloudflare:test'
import { env } from 'cloudflare:workers'

// Setup files may run more than once; applyD1Migrations() only applies
// migrations that haven't already been applied, so this is safe to repeat.
await applyD1Migrations(env.AUTH_DB, env.TEST_MIGRATIONS)
```

`apps/worker-auth/vitest.config.ts`:
```ts
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

- [ ] **Step 13: Run test to verify it passes**

Run: `npx vitest run`
Expected: PASS. If it still fails, the most likely gap is a missing/misnamed env var in `.dev.vars` (Step 5) — the error message will name the missing key.

- [ ] **Step 14: Commit**

```bash
git add apps/worker-auth
git commit -m "$(cat <<'EOF'
feat(auth): wire D1 + Drizzle + Better Auth with Google sign-in

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Google sign-in flow — sign-up, returning sign-in, session, sign-out

**Files:**
- Modify: `apps/worker-auth/package.json` (add `msw`, `@msw/cloudflare` dev dependencies)
- Create: `apps/worker-auth/test/helpers/google-network.ts`
- Test: `apps/worker-auth/test/google-sign-in.test.ts`

**Interfaces:**
- Consumes: `app` (Task 1), the mounted `/api/auth/*` routes (Task 2).
- Produces: `googleNetwork` and `mockGoogleAccount(profile)` from `test/helpers/google-network.ts`, reused by Task 4's test.

Real Google endpoints being mocked: token exchange at `https://oauth2.googleapis.com/token`, profile lookup at `https://www.googleapis.com/oauth2/v3/userinfo`. If the failing test's output shows Better Auth's Google provider calling different URLs, update the mock handlers in `google-network.ts` to match — that's the one detail here confirmed by running the test rather than by doc lookup.

- [ ] **Step 1: Add mocking dependencies**

Add to `apps/worker-auth/package.json` `devDependencies`: `"msw": "^2.15.0"`, `"@msw/cloudflare": "^0.0.1"`.

Run: `npm install` from repo root.

- [ ] **Step 2: Write the Google network mock helper**

`apps/worker-auth/test/helpers/google-network.ts`:
```ts
import { setupNetwork } from '@msw/cloudflare'
import { http, HttpResponse } from 'msw'

export const googleNetwork = setupNetwork()

export function mockGoogleAccount(profile: { sub: string; email: string; name: string }) {
    googleNetwork.use(
        http.post('https://oauth2.googleapis.com/token', () =>
            HttpResponse.json({
                access_token: 'test-access-token',
                token_type: 'Bearer',
                expires_in: 3600,
                scope: 'openid email profile',
                id_token: 'test-id-token'
            })
        ),
        http.get('https://www.googleapis.com/oauth2/v3/userinfo', () => HttpResponse.json(profile))
    )
}
```

- [ ] **Step 3: Write the failing tests**

`apps/worker-auth/test/google-sign-in.test.ts`:
```ts
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest'
import app from '../src/index'
import { googleNetwork, mockGoogleAccount } from './helpers/google-network'

beforeAll(() => googleNetwork.enable())
afterEach(() => googleNetwork.resetHandlers())
afterAll(() => googleNetwork.disable())

async function callAsApp(request: Request) {
    const ctx = createExecutionContext()
    const response = await app.fetch(request, env, ctx)
    await waitOnExecutionContext(ctx)
    return response
}

async function completeGoogleSignIn(profile: { sub: string; email: string; name: string }) {
    mockGoogleAccount(profile)

    const authorizeResponse = await callAsApp(
        new Request('https://example.com/api/auth/sign-in/social?provider=google&callbackURL=https://example.com/')
    )
    const location = authorizeResponse.headers.get('location')
    if (!location) throw new Error('expected a redirect to Google from /api/auth/sign-in/social')
    const state = new URL(location).searchParams.get('state')

    return callAsApp(new Request(`https://example.com/api/auth/callback/google?code=test-code&state=${state}`))
}

describe('Google sign-in', () => {
    it('redirects to Google with the expected client_id, redirect_uri, and scope', async ({ expect }) => {
        const response = await callAsApp(
            new Request('https://example.com/api/auth/sign-in/social?provider=google&callbackURL=https://example.com/')
        )
        const location = response.headers.get('location')
        if (!location) throw new Error('expected a redirect to Google')
        const params = new URL(location).searchParams

        expect(location).toMatch(/^https:\/\/accounts\.google\.com\//)
        expect(params.get('client_id')).toBeTruthy()
        expect(params.get('redirect_uri')).toContain('/api/auth/callback/google')
        expect(params.get('scope')).toContain('email')
    })

    it('creates a new user, account, and session on first sign-in', async ({ expect }) => {
        const response = await completeGoogleSignIn({ sub: 'google-1', email: 'ada@example.com', name: 'Ada' })

        expect(response.status).toBeLessThan(400)
        expect(response.headers.get('set-cookie')).toBeTruthy()

        const { results: users } = await env.AUTH_DB.prepare('SELECT * FROM user WHERE email = ?')
            .bind('ada@example.com')
            .all<{ role: string }>()
        expect(users).toHaveLength(1)
        expect(users[0]?.role).toBe('user')
    })

    it('reuses the same user on a returning sign-in, without creating a duplicate', async ({ expect }) => {
        await completeGoogleSignIn({ sub: 'google-2', email: 'grace@example.com', name: 'Grace' })
        await completeGoogleSignIn({ sub: 'google-2', email: 'grace@example.com', name: 'Grace' })

        const { results: users } = await env.AUTH_DB.prepare('SELECT * FROM user WHERE email = ?')
            .bind('grace@example.com')
            .all()
        expect(users).toHaveLength(1)
    })

    it('returns the signed-in user from get-session, and clears it on sign-out', async ({ expect }) => {
        const signInResponse = await completeGoogleSignIn({ sub: 'google-3', email: 'lin@example.com', name: 'Lin' })
        const cookie = signInResponse.headers.get('set-cookie')?.split(';')[0]
        if (!cookie) throw new Error('expected a session cookie from sign-in')

        const sessionResponse = await callAsApp(
            new Request('https://example.com/api/auth/get-session', { headers: { cookie } })
        )
        const session = await sessionResponse.json<{ user: { email: string; role: string } }>()
        expect(session.user.email).toBe('lin@example.com')
        expect(session.user.role).toBe('user')

        await callAsApp(new Request('https://example.com/api/auth/sign-out', { method: 'POST', headers: { cookie } }))

        const afterSignOut = await callAsApp(
            new Request('https://example.com/api/auth/get-session', { headers: { cookie } })
        )
        expect(await afterSignOut.json()).toBeNull()
    })
})
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run`
Expected: FAIL — `test/helpers/google-network.ts` and its `msw`/`@msw/cloudflare` imports don't resolve until Step 1/2 land in the working tree (if run out of order), or the assertions fail against real behavior. Confirm the failure is about missing mocks/wiring, not a typo in the test itself.

- [ ] **Step 5: Fix any gaps surfaced by the failing run**

If Step 4's failure is about the mock module (expected on first run), nothing further is needed — Steps 1–3 already are the implementation here; re-run.

If instead the callback genuinely fails against `src/auth.ts` (e.g. a trusted-origin rejection, or Google's real endpoint paths differing from the mock's), fix `src/auth.ts` or `google-network.ts` accordingly based on the actual error message.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/worker-auth
git commit -m "$(cat <<'EOF'
feat(auth): cover Google sign-up, sign-in, session, and sign-out

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: Manual, one-time real-browser check**

Not part of the automated suite — Google's actual consent screen can't be scripted. Requires a real Google Cloud OAuth client (create one manually in Google Cloud Console; authorized redirect URI `http://localhost:8787/api/auth/callback/google`).

```bash
cd apps/worker-auth
# fill in real GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in .dev.vars first
npx wrangler d1 migrations apply AUTH_DB --local
npx wrangler dev
```
`wrangler dev`'s local D1 storage (under `.wrangler/state`) is separate from the ephemeral per-test-run D1 the Vitest suite uses — it needs migrations applied on its own the first time.
In a browser, visit `http://localhost:8787/api/auth/sign-in/social?provider=google&callbackURL=http://localhost:8787/`, complete Google's real consent screen, and confirm the callback succeeds. This is a sanity check that the mocked test suite matches Google's real behavior — no code changes expected from this step.

---

### Task 4: OAuth provider plugin — linking a new application end-to-end

**Files:**
- Modify: `apps/worker-auth/src/auth.ts` (add `jwt` and `oauthProvider` plugins)
- Modify: `apps/worker-auth/src/db/schema.ts` (regenerated — new plugin tables)
- Create: `apps/worker-auth/drizzle/0001_*.sql` (regenerated migration)
- Test: `apps/worker-auth/test/oauth-provider.test.ts`

**Interfaces:**
- Consumes: `app`, `callAsApp` pattern, `googleNetwork`/`mockGoogleAccount` from Task 3.

The `oauthProvider` plugin's route table (confirmed against its current docs): authorize (`GET/POST /oauth2/authorize`), token (`POST /oauth2/token`), userinfo (`GET /oauth2/userinfo`), create client (`POST /oauth2/create-client`) — all mounted under Better Auth's basePath, i.e. `/api/auth/oauth2/*`. Client creation via `POST /oauth2/create-client` is an authenticated action (requires a signed-in user's session cookie). The exact response field names below (`client_id`, `client_secret`) follow standard OAuth 2.1 client registration conventions; if the failing test's actual response shape differs, adjust the assertions to match what the endpoint really returns rather than the other way around.

- [ ] **Step 1: Write the failing test**

`apps/worker-auth/test/oauth-provider.test.ts`:
```ts
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest'
import app from '../src/index'
import { googleNetwork, mockGoogleAccount } from './helpers/google-network'

beforeAll(() => googleNetwork.enable())
afterEach(() => googleNetwork.resetHandlers())
afterAll(() => googleNetwork.disable())

async function callAsApp(request: Request) {
    const ctx = createExecutionContext()
    const response = await app.fetch(request, env, ctx)
    await waitOnExecutionContext(ctx)
    return response
}

describe('OAuth provider (linking a new application)', () => {
    it('lets a signed-in user register a client, then completes the authorization-code flow for it', async ({
        expect
    }) => {
        mockGoogleAccount({ sub: 'google-4', email: 'imogen@example.com', name: 'Imogen' })
        const authorizeResponse = await callAsApp(
            new Request('https://example.com/api/auth/sign-in/social?provider=google&callbackURL=https://example.com/')
        )
        const state = new URL(authorizeResponse.headers.get('location')!).searchParams.get('state')
        const signInResponse = await callAsApp(
            new Request(`https://example.com/api/auth/callback/google?code=test-code&state=${state}`)
        )
        const cookie = signInResponse.headers.get('set-cookie')?.split(';')[0]
        if (!cookie) throw new Error('expected a session cookie from sign-in')

        const createClientResponse = await callAsApp(
            new Request('https://example.com/api/auth/oauth2/create-client', {
                method: 'POST',
                headers: { cookie, 'content-type': 'application/json' },
                body: JSON.stringify({
                    redirect_uris: ['https://linked-app.example.com/callback'],
                    skip_consent: true
                })
            })
        )
        expect(createClientResponse.status).toBeLessThan(300)
        const client = await createClientResponse.json<{ client_id: string; client_secret: string }>()
        expect(client.client_id).toBeTruthy()

        const authorizeClientResponse = await callAsApp(
            new Request(
                `https://example.com/api/auth/oauth2/authorize?response_type=code&client_id=${client.client_id}&redirect_uri=${encodeURIComponent(
                    'https://linked-app.example.com/callback'
                )}&scope=openid%20profile%20email`,
                { headers: { cookie } }
            )
        )
        const redirectLocation = authorizeClientResponse.headers.get('location')
        if (!redirectLocation) throw new Error('expected a redirect back to the linked app with an authorization code')
        const code = new URL(redirectLocation).searchParams.get('code')
        expect(code).toBeTruthy()

        const tokenResponse = await callAsApp(
            new Request('https://example.com/api/auth/oauth2/token', {
                method: 'POST',
                headers: { 'content-type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    grant_type: 'authorization_code',
                    code: code!,
                    redirect_uri: 'https://linked-app.example.com/callback',
                    client_id: client.client_id,
                    client_secret: client.client_secret
                })
            })
        )
        expect(tokenResponse.status).toBe(200)
        const tokens = await tokenResponse.json<{ access_token: string }>()
        expect(tokens.access_token).toBeTruthy()

        const userinfoResponse = await callAsApp(
            new Request('https://example.com/api/auth/oauth2/userinfo', {
                headers: { authorization: `Bearer ${tokens.access_token}` }
            })
        )
        expect(userinfoResponse.status).toBe(200)
        const userinfo = await userinfoResponse.json<{ email: string }>()
        expect(userinfo.email).toBe('imogen@example.com')
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run`
Expected: FAIL — `/api/auth/oauth2/*` routes don't exist yet (404 on `create-client`).

- [ ] **Step 3: Add the plugins**

In `apps/worker-auth/src/auth.ts`, add imports and wire the plugins into the `betterAuth()` config:
```ts
import { oauthProvider } from '@better-auth/oauth-provider'
import { jwt } from 'better-auth/plugins'
```
Add to the `betterAuth({...})` object (alongside `trustedOrigins`):
```ts
        plugins: [
            jwt(),
            oauthProvider({
                loginPage: '/sign-in',
                consentPage: '/consent'
            })
        ]
```
`loginPage`/`consentPage` are only reached for unauthenticated users or clients without `skip_consent` — neither happens in this plan's scope, so these paths are never actually implemented as pages.

- [ ] **Step 4: Regenerate the schema and migration**

Run (from `apps/worker-auth`):
```bash
npx auth@latest generate --config ./auth.cli.ts --adapter drizzle --dialect sqlite --output src/db/schema.ts
npx drizzle-kit generate
```
This adds the `oauthProvider`/`jwt` plugin tables (registered client applications, tokens, consents) to `src/db/schema.ts` and writes a new migration file to `apps/worker-auth/drizzle/0001_*.sql`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run`
Expected: PASS. If `create-client` or `authorize` respond with a different shape than assumed (e.g. a different field name for the client secret, or consent not actually skipped), adjust the test assertions and request bodies to match the real response — the route paths and the requirement that client creation be authenticated are the two facts confirmed ahead of time; the exact field names are what this step verifies for real.

- [ ] **Step 6: Commit**

```bash
git add apps/worker-auth
git commit -m "$(cat <<'EOF'
feat(auth): add OAuth provider plugin for linking future applications

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Documentation

**Files:**
- Create: `apps/worker-auth/CLAUDE.md`
- Modify: `/home/sono/virtual-classroom/CLAUDE.md`
- Modify: `packages/config-typescript/CLAUDE.md`

No new behavior — this task documents what Tasks 1–4 built, matching the style of `apps/worker-realtime/CLAUDE.md`. No test cycle applies to documentation; verify by reading it back for accuracy against the actual files.

- [ ] **Step 1: Write `apps/worker-auth/CLAUDE.md`**

```markdown
# CLAUDE.md — worker-auth

`@capstone/auth` — the identity worker. A Cloudflare Worker that owns all user/session/credential data for the whole monorepo: Google sign-in/sign-up via Better Auth, backed by D1, plus Better Auth's `oauthProvider` plugin so future applications can link in as OAuth clients instead of touching this worker's database directly.

## Layout

- `src/index.ts` — Hono app. Serves a trivial `/` health route and mounts Better Auth's handler at `/api/auth/*`.
- `src/auth.ts` — `createAuth(db, env)`, the Better Auth factory (Google social provider, `role` additional field, `jwt` + `oauthProvider` plugins). Built as a factory rather than a module-level singleton because the D1 binding only exists inside a request's `env`.
- `src/db/client.ts` — `createDb(d1)`, wraps the `AUTH_DB` binding in a Drizzle client.
- `src/db/schema.ts` — **generated** by `npx auth@latest generate` (see `auth.cli.ts` below), then owned/hand-edited from there. Don't hand-author from scratch; regenerate after adding/changing plugins.
- `auth.cli.ts` — Node-only shim used solely by the Better Auth CLI to generate `src/db/schema.ts` (the CLI can't see a real D1 binding). Never imported by the Worker itself.
- `drizzle.config.ts` / `drizzle/*.sql` — `drizzle-kit`-generated migrations, applied via `wrangler d1 migrations apply AUTH_DB` (uses the `migrations_dir` set in `wrangler.jsonc`).
- `worker-configuration.d.ts` — **generated** by `wrangler types`; don't Read it in full — `grep` for the specific binding/type you need.

## Regenerating the schema after a config change

```bash
npx auth@latest generate --config ./auth.cli.ts --adapter drizzle --dialect sqlite --output src/db/schema.ts
npx drizzle-kit generate
```

## Testing

`@cloudflare/vitest-pool-workers` runs tests inside the real Workers runtime against a real local D1 (migrations applied automatically via `test/apply-migrations.ts`). Outbound calls to Google are mocked with `@msw/cloudflare` (`test/helpers/google-network.ts`) so the full sign-in/callback path runs deterministically without a real Google account. Run: `npm test` (watch) or `npm run test:run` (single run).

One thing the automated suite can't cover: an actual round trip through Google's real consent screen. That's a manual, one-time check via `wrangler dev` with a real Google Cloud OAuth client — see the auth worker design spec's Testing section.

## Commands (run from this directory, or via `npm run <script> -w @capstone/auth` from root)

- `dev` / `start` — `wrangler dev`
- `deploy` — `wrangler deploy`
- `typegen` — `wrangler types` (regenerates `worker-configuration.d.ts`)
- `test` / `test:run` — Vitest

No code here talks to `worker-client` or `worker-realtime` yet — this worker deploys independently. See the [auth worker design spec](../../docs/superpowers/specs/2026-08-26-auth-worker-design.md) for what's deliberately deferred (roles/permissions design, wiring up consumers, additional identity providers, custom domain).
```

- [ ] **Step 2: Update the root `CLAUDE.md` monorepo map**

Read `/home/sono/virtual-classroom/CLAUDE.md`'s "Project overview" section first — it currently says "two deployable apps and two shared packages" and lists `apps/worker-client` and `apps/worker-realtime`. Update the count wording to "three deployable apps and two shared packages", and add a bullet after the `worker-realtime` line:
```markdown
- `apps/worker-auth` (`@capstone/auth`) — the identity worker: Google sign-in/sign-up and the OAuth provider other apps will link against. See [apps/worker-auth/CLAUDE.md](apps/worker-auth/CLAUDE.md).
```
Also update the line "The two apps are independent Cloudflare Workers deployed separately (no service bindings between them yet)" to reflect three independent apps.

- [ ] **Step 3: Update `packages/config-typescript/CLAUDE.md`**

Add `apps/worker-auth` to the `tsconfig.worker.json` example consumers list (currently reads "e.g. `apps/worker-realtime`, and `worker-client/tsconfig.worker.json`"), so it reads "e.g. `apps/worker-realtime`, `apps/worker-auth`, and `worker-client/tsconfig.worker.json`".

- [ ] **Step 4: Commit**

```bash
git add apps/worker-auth/CLAUDE.md CLAUDE.md packages/config-typescript/CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: document the new worker-auth workspace

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
