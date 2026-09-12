# Worker Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up `apps/worker-admin`, a separately deployed Cloudflare Worker that exposes user-management/role-assignment admin operations, without duplicating any user data or auth logic out of `worker-auth`.

**Architecture:** `worker-admin` is a bare `ExportedHandler` that proxies every `/api/auth/*` request (which includes Better Auth's `admin` plugin routes, mounted at `/api/auth/admin/*`) to `worker-auth` over a service binding, and 404s everything else — a copy of `apps/worker-client/worker/index.ts`'s existing passthrough shape. `worker-auth` gains the `admin` plugin (bootstrapped via an `ADMIN_USER_IDS` env var) and the `bearer` plugin (so a session started on `worker-client`'s origin can be presented to `worker-admin`'s separate origin via an `Authorization: Bearer` header instead of a cross-origin cookie).

**Tech Stack:** Cloudflare Workers, Better Auth (`admin` + `bearer` plugins, already-installed `better-auth` package — no new dependency), Vitest + `@cloudflare/vitest-pool-workers` (existing test tooling in `worker-auth`, newly added to `worker-admin`), Turborepo/npm workspaces, Biome, Changesets.

**Spec:** `docs/superpowers/specs/2026-09-12-worker-admin-design.md`

## Global Constraints

- `worker-admin` has no database and no Better Auth instance of its own — it is a pure proxy; all authorization logic lives in `worker-auth`'s `admin` plugin.
- `worker-admin` has zero runtime dependencies (no Hono, no `@capstone/standards`) — matches `apps/worker-client/worker/index.ts`'s bare `ExportedHandler`, confirmed against that file and its `package.json`.
- API only in this pass — no frontend/UI for `worker-admin`.
- `adminRoles` is left unset on the `admin` plugin (its default `['admin']` already matches the existing `user.role` placeholder — confirmed against `node_modules/better-auth/dist/plugins/admin/admin.mjs`).
- Bootstrap admin access is via `ADMIN_USER_IDS` (comma-separated Better Auth user ids), passed as `adminUserIds` — confirmed this option unconditionally bypasses the normal role/permission check, in `node_modules/better-auth/dist/plugins/admin/has-permission.mjs`.
- `worker-admin`'s fixed local dev port is `8790` / inspector `9232` (next free pair after `worker-realtime` `8788`/`9231`, `worker-auth` `8789`/`9230`, and `worker-client`'s Vite defaults `5173`/`9229`).
- Every new/modified workspace follows existing repo conventions: Biome formatting (4-space, single quotes, no semicolons — enforced by `lint-staged`, don't hand-format), `tsconfig.json` extending `@capstone/typescript`, `wrangler types` for `worker-configuration.d.ts` (never hand-edited), a workspace `CLAUDE.md`.

---

## Task 1: Scaffold `apps/worker-admin` as a passthrough Worker

**Files:**
- Create: `apps/worker-admin/package.json`
- Create: `apps/worker-admin/wrangler.jsonc`
- Create: `apps/worker-admin/tsconfig.json`
- Create: `apps/worker-admin/src/index.ts`
- Create: `apps/worker-admin/vitest.config.mjs`
- Create: `apps/worker-admin/test/tsconfig.json`
- Test: `apps/worker-admin/test/index.test.ts`

**Interfaces:**
- Produces: a deployable Worker `worker-admin` with a service binding `AUTH_SERVICE: Fetcher` (typed into `apps/worker-admin/worker-configuration.d.ts` once `typegen` runs in Step 11). Task 2 does not depend on anything this task produces (it only touches `apps/worker-auth`), but Task 3 (docs) references this workspace's final shape.

- [ ] **Step 1: Create `apps/worker-admin/package.json`**

```json
{
    "name": "@capstone/admin",
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

- [ ] **Step 2: Create `apps/worker-admin/wrangler.jsonc`**

```jsonc
/**
 * For more details on how to configure Wrangler, refer to:
 * https://developers.cloudflare.com/workers/wrangler/configuration/
 */
{
    "$schema": "../../node_modules/wrangler/config-schema.json",
    "name": "worker-admin",
    "main": "src/index.ts",
    "compatibility_date": "2026-09-12",
    "observability": {
        "enabled": true
    },
    "upload_source_maps": true,
    "dev": {
        // 8787/8788/8789 are taken by wrangler's default and worker-realtime/worker-auth;
        // 9229/9230/9231 by worker-client's Vite inspector, worker-realtime, and worker-auth.
        "port": 8790,
        "inspector_port": 9232
    },
    /**
     * Service Bindings (communicate between multiple Workers)
     * https://developers.cloudflare.com/workers/wrangler/configuration/#service-bindings
     */
    "services": [{ "binding": "AUTH_SERVICE", "service": "worker-auth" }]
}
```

- [ ] **Step 3: Create `apps/worker-admin/tsconfig.json`**

```json
{
    "extends": "@capstone/typescript/configs/tsconfig.worker.json",
    "compilerOptions": {
        "types": ["./worker-configuration.d.ts", "node"]
    },
    "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Install workspace dependencies**

Run from the repo root (not inside `apps/worker-admin` — npm workspaces resolve from root):

```bash
npm install
```

Expected: npm links the new `@capstone/admin` workspace and installs its `devDependencies`. No source files exist yet, so nothing else changes.

- [ ] **Step 5: Create `apps/worker-admin/vitest.config.mjs`**

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

- [ ] **Step 6: Create `apps/worker-admin/test/tsconfig.json`**

```json
{
    "extends": "../tsconfig.json",
    "compilerOptions": {
        "types": ["@cloudflare/vitest-pool-workers/types", "node"]
    },
    "include": ["./**/*.ts", "../worker-configuration.d.ts"]
}
```

- [ ] **Step 7: Write the failing test — `apps/worker-admin/test/index.test.ts`**

```ts
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { it } from 'vitest'
import app from '../src/index'

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

- [ ] **Step 8: Run the test to verify it fails**

Run: `npm run test:run -w @capstone/admin`
Expected: FAIL — `../src/index` does not exist yet (`Cannot find module` or equivalent).

- [ ] **Step 9: Write the minimal implementation — `apps/worker-admin/src/index.ts`**

```ts
export default {
    fetch(request, env) {
        const url = new URL(request.url)

        if (url.pathname.startsWith('/api/auth/')) {
            return env.AUTH_SERVICE.fetch(request)
        }

        return new Response(null, { status: 404 })
    }
} satisfies ExportedHandler<Env>
```

- [ ] **Step 10: Run the test to verify it passes**

Run: `npm run test:run -w @capstone/admin`
Expected: PASS (both tests).

- [ ] **Step 11: Generate `worker-configuration.d.ts`**

Run: `npm run typegen -w @capstone/admin`
Expected: creates `apps/worker-admin/worker-configuration.d.ts`, typing `Env.AUTH_SERVICE` as a `Fetcher`. Don't hand-edit this file; don't `Read` it in full (it's large, deny-listed per root `CLAUDE.md` — `grep` it if you need to confirm a symbol).

- [ ] **Step 12: Lint and commit**

```bash
npx biome check --write apps/worker-admin
git add apps/worker-admin package-lock.json
git commit -m "feat(admin): scaffold worker-admin as a passthrough to worker-auth"
```

---

## Task 2: Add `admin`/`bearer` plugins and the `ADMIN_USER_IDS` bootstrap to `worker-auth`

**Files:**
- Modify: `apps/worker-auth/src/auth.ts`
- Modify: `apps/worker-auth/test/helpers/call-app.ts`
- Modify: `apps/worker-auth/.dev.vars.example`
- Modify (generated, not hand-edited): `apps/worker-auth/src/db/schema.ts`
- Create (generated, not hand-edited): a new migration file under `apps/worker-auth/drizzle/`
- Test: `apps/worker-auth/test/admin.test.ts`

**Interfaces:**
- Consumes: `createAuth(db: Db, env: Env)` from `apps/worker-auth/src/auth.ts` (existing, signature unchanged). `callAsApp(request: Request)` from `apps/worker-auth/test/helpers/call-app.ts` (existing; this task extends its signature — see Step 1).
- Produces: `callAsApp(request: Request, envOverrides?: Partial<Env>): Promise<Response>` — the extended test helper every later test in `apps/worker-auth/test/` can use to override env vars (e.g. `ADMIN_USER_IDS`) per-call without mutating global state.

- [ ] **Step 1: Extend the test helper to accept per-call env overrides**

This is written first (not as a failing test — it's test infrastructure, not behavior) because Step 4 below needs it. Modify `apps/worker-auth/test/helpers/call-app.ts`:

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

Run: `npm run test:run -w @capstone/auth`
Expected: PASS — all existing tests still pass unchanged (the new parameter is optional and defaults to no override).

- [ ] **Step 2: Add `ADMIN_USER_IDS` to the dev vars example**

Modify `apps/worker-auth/.dev.vars.example`:

```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
BETTER_AUTH_SECRET=
BETTER_AUTH_URL=http://localhost:5173
ADMIN_USER_IDS=
```

Also add the same `ADMIN_USER_IDS=` line to your local `apps/worker-auth/.dev.vars` (gitignored, not committed) — leave the value empty for now; it's only consulted for local `wrangler dev`, not for the automated tests below (those override it per-call via Step 1's helper).

- [ ] **Step 3: Regenerate `worker-configuration.d.ts` so `env.ADMIN_USER_IDS` is typed**

Run: `npm run typegen -w @capstone/auth`
Expected: `apps/worker-auth/worker-configuration.d.ts` regenerates with an `ADMIN_USER_IDS: string` entry on `Env`. Confirm with `grep ADMIN_USER_IDS apps/worker-auth/worker-configuration.d.ts` rather than reading the file (it's large and deny-listed).

- [ ] **Step 4: Write the failing tests — `apps/worker-auth/test/admin.test.ts`**

```ts
import { env } from 'cloudflare:workers'
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest'
import { callAsApp } from './helpers/call-app'
import { googleNetwork, mockGoogleAccount } from './helpers/google-network'

beforeAll(() => googleNetwork.enable())
afterEach(() => googleNetwork.resetHandlers())
afterAll(() => googleNetwork.disable())

async function signInWithGoogle(profile: { sub: string; email: string; name: string }) {
    mockGoogleAccount(profile)

    const authorizeResponse = await callAsApp(
        new Request('https://example.com/api/auth/sign-in/social', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ provider: 'google', callbackURL: 'https://example.com/' })
        })
    )
    const { url } = await authorizeResponse.json<{ url: string }>()
    if (!url) throw new Error('expected an authorize URL from /api/auth/sign-in/social')
    const state = new URL(url).searchParams.get('state')
    const stateCookie = authorizeResponse.headers.get('set-cookie')?.split(';')[0]
    if (!stateCookie) throw new Error('expected a state cookie from /api/auth/sign-in/social')

    const signInResponse = await callAsApp(
        new Request(`https://example.com/api/auth/callback/google?code=test-code&state=${state}`, {
            headers: { cookie: stateCookie }
        })
    )
    const cookie = signInResponse.headers
        .getSetCookie()
        .find(entry => entry.includes('session_token'))
        ?.split(';')[0]
    if (!cookie) throw new Error('expected a session cookie from sign-in')
    return cookie
}

async function userIdForEmail(email: string) {
    const { results } = await env.AUTH_DB.prepare('SELECT id FROM user WHERE email = ?').bind(email).all<{ id: string }>()
    const id = results[0]?.id
    if (!id) throw new Error(`expected a user row for ${email}`)
    return id
}

describe('admin plugin', () => {
    it('rejects a signed-in user who is not an admin', async ({ expect }) => {
        const cookie = await signInWithGoogle({ sub: 'google-10', email: 'nadia@example.com', name: 'Nadia' })

        const response = await callAsApp(
            new Request('https://example.com/api/auth/admin/list-users?limit=10', { headers: { cookie } }),
            { ADMIN_USER_IDS: '' }
        )
        expect(response.status).toBe(403)
    })

    it('lets a user listed in ADMIN_USER_IDS call admin endpoints regardless of their role column', async ({ expect }) => {
        const cookie = await signInWithGoogle({ sub: 'google-11', email: 'omar@example.com', name: 'Omar' })
        const userId = await userIdForEmail('omar@example.com')

        const response = await callAsApp(
            new Request('https://example.com/api/auth/admin/list-users?limit=10', { headers: { cookie } }),
            { ADMIN_USER_IDS: userId }
        )
        expect(response.status).toBe(200)
        const { users } = await response.json<{ users: { email: string }[] }>()
        expect(users.some(u => u.email === 'omar@example.com')).toBe(true)
    })

    it('lets a bootstrap admin promote another user, who can then call admin endpoints without being in ADMIN_USER_IDS', async ({ expect }) => {
        const adminCookie = await signInWithGoogle({ sub: 'google-12', email: 'priya@example.com', name: 'Priya' })
        const adminId = await userIdForEmail('priya@example.com')

        const targetCookie = await signInWithGoogle({ sub: 'google-13', email: 'sam@example.com', name: 'Sam' })
        const targetId = await userIdForEmail('sam@example.com')

        const setRoleResponse = await callAsApp(
            new Request('https://example.com/api/auth/admin/set-role', {
                method: 'POST',
                headers: { cookie: adminCookie, origin: 'https://example.com', 'content-type': 'application/json' },
                body: JSON.stringify({ userId: targetId, role: 'admin' })
            }),
            { ADMIN_USER_IDS: adminId }
        )
        expect(setRoleResponse.status).toBe(200)

        // ADMIN_USER_IDS is empty here on purpose: this call must succeed only via the
        // promoted `role` column, not the bootstrap list.
        const response = await callAsApp(
            new Request('https://example.com/api/auth/admin/list-users?limit=10', { headers: { cookie: targetCookie } }),
            { ADMIN_USER_IDS: '' }
        )
        expect(response.status).toBe(200)
    })

    it('accepts a session presented as a bearer token instead of a cookie', async ({ expect }) => {
        const cookie = await signInWithGoogle({ sub: 'google-14', email: 'theo@example.com', name: 'Theo' })

        const sessionResponse = await callAsApp(new Request('https://example.com/api/auth/get-session', { headers: { cookie } }))
        const token = sessionResponse.headers.get('set-auth-token')
        if (!token) throw new Error('expected a set-auth-token header from the bearer plugin')

        const bearerResponse = await callAsApp(
            new Request('https://example.com/api/auth/get-session', { headers: { authorization: `Bearer ${token}` } })
        )
        const session = await bearerResponse.json<{ user: { email: string } }>()
        expect(session.user.email).toBe('theo@example.com')
    })
})
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `npm run test:run -w @capstone/auth`
Expected: FAIL — `/api/auth/admin/list-users` and `/api/auth/admin/set-role` don't exist yet (404 from Better Auth's router, or a thrown error), and no `set-auth-token` response header is set.

- [ ] **Step 6: Add the `admin` and `bearer` plugins — modify `apps/worker-auth/src/auth.ts`**

Full new contents:

```ts
import { oauthProvider } from '@better-auth/oauth-provider'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin, bearer, jwt } from 'better-auth/plugins'
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
        // 'http://localhost:8790' is worker-admin's fixed local dev port
        // (apps/worker-admin/wrangler.jsonc) — its calls proxy through here and need to pass
        // Better Auth's origin check.
        trustedOrigins: [env.BETTER_AUTH_URL, 'https://example.com', 'http://localhost:8790'],
        plugins: [
            jwt(),
            oauthProvider({
                loginPage: '/login',
                consentPage: '/consent'
            }),
            admin({
                // adminUserIds bootstraps the first admin account(s) without a manual DB write
                // or an existing admin to grant the role — any user whose id is listed here is
                // treated as an admin regardless of their `role` column (confirmed against
                // node_modules/better-auth/dist/plugins/admin/has-permission.mjs). Comma-separated
                // Better Auth user ids; further admins get promoted via /admin/set-role instead.
                adminUserIds: env.ADMIN_USER_IDS?.split(',').filter(Boolean) ?? []
            }),
            // Converts an `Authorization: Bearer <token>` header into the same session a cookie
            // would carry, so worker-admin — a separate origin with no cookie of its own, since
            // Google's redirect_uri (and so the session cookie) is pinned to worker-client's
            // origin — can forward a session established there through its proxy. See
            // docs/superpowers/specs/2026-09-12-worker-admin-design.md.
            bearer()
        ]
    })
}
```

- [ ] **Step 7: Regenerate the Drizzle schema for the new plugin fields**

The `admin` plugin adds columns Better Auth reads/writes on *every* session creation (not just admin calls) — `user.banned`, `user.banReason`, `user.banExpires`, and `session.impersonatedBy` (confirmed against `node_modules/better-auth/dist/plugins/admin/admin.d.mts`'s `schema` block). Without these columns, sign-in itself breaks, not just the new admin endpoints. Per the regeneration workflow in `apps/worker-auth/CLAUDE.md`:

```bash
npx auth@latest generate --config ./auth.cli.ts --adapter drizzle --dialect sqlite --output src/db/schema.ts -y
```

Then inspect `git diff src/db/schema.ts`: expect only additive changes — `banned` (boolean, default false), `banReason` (text, nullable), `banExpires` (timestamp, nullable) added to the `user` table, and `impersonatedBy` (text, nullable) added to the `session` table. If anything else changed (a renamed column, a dropped table), stop and investigate before continuing — don't hand-edit the generated diff away.

- [ ] **Step 8: Generate the migration**

```bash
npx drizzle-kit generate
```

Expected: a new file appears under `apps/worker-auth/drizzle/` (after `0001_elite_black_bird.sql`) containing `ALTER TABLE` statements adding the four columns from Step 7. `apps/worker-auth/vitest.config.mjs` already re-reads every migration file under `drizzle/` on each test run (`readD1Migrations`), so no test config changes are needed for the new migration to apply.

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npm run test:run -w @capstone/auth`
Expected: PASS (all tests in `admin.test.ts`, and every pre-existing test file still passes).

- [ ] **Step 10: Lint and commit**

```bash
npx biome check --write apps/worker-auth
git add apps/worker-auth
git commit -m "feat(auth): add admin/bearer plugins with ADMIN_USER_IDS bootstrap"
```

---

## Task 3: Documentation and versioning

**Files:**
- Create: `apps/worker-admin/CLAUDE.md`
- Modify: `apps/worker-auth/CLAUDE.md`
- Modify: `CLAUDE.md` (root)
- Create: `.changeset/<auto-generated-name>.md` (via the `changeset` CLI, not hand-written)

**Interfaces:** None — this task only touches documentation and version metadata, no code.

- [ ] **Step 1: Create `apps/worker-admin/CLAUDE.md`**

(Note the outer fence below uses four backticks because the content itself contains a fenced `bash` example — don't copy the outer four backticks into the file.)

````markdown
# CLAUDE.md — worker-admin

`@capstone/admin` — the admin worker. A separately deployed Cloudflare Worker for admin tasks (user management, role assignment), kept apart from `worker-client` so the client bundle/deploy stays unrelated to admin surface area.

## Layout

- `src/index.ts` — the whole worker: a bare `ExportedHandler` that forwards any `/api/auth/*` request to `AUTH_SERVICE` (a service binding to `worker-auth`) and 404s everything else. Byte-for-byte the same shape as `apps/worker-client/worker/index.ts`'s passthrough.
- `worker-configuration.d.ts` — **generated** by `wrangler types` (`typegen` script); don't Read it in full (blocked via `.claude/settings.json` deny rule) — `grep` for the specific binding/type you need.

## Why this worker has no logic of its own

Better Auth's `admin` plugin (configured in `apps/worker-auth/src/auth.ts`) mounts its routes under the auth instance's own basePath — `/api/auth/admin/*` — so proxying all of `/api/auth/*` already exposes every admin operation (list/search users, `set-role`, ban/unban, remove, impersonate). `worker-auth` is the single place that decides who's allowed to call them; this worker deliberately does not duplicate that check, so there's only one place authorization logic can drift out of sync. See `docs/superpowers/specs/2026-09-12-worker-admin-design.md` for the full design.

## Calling it

No browser UI in this pass — call the API directly. Since Google's OAuth `redirect_uri` (and so the session cookie) is pinned to `worker-client`'s origin, an admin session can't be picked up here via cookie. Instead, sign in through `worker-client` as usual, grab your session's bearer token (Better Auth's `bearer` plugin returns one via a `set-auth-token` response header on any request that touches your session, e.g. `get-session`), and call this worker with it:

```bash
curl -H "Authorization: Bearer <token>" http://localhost:8790/api/auth/admin/list-users
```

The very first admin account is granted via `worker-auth`'s `ADMIN_USER_IDS` env var (a comma-separated list of Better Auth user ids) — see `apps/worker-auth/CLAUDE.md`. Once at least one admin exists, further admins are promoted via `POST /api/auth/admin/set-role`.

## Commands (run from this directory, or via `npm run <script> -w @capstone/admin` from root)

- `dev` / `start` — `wrangler dev` (fixed local port `8790`, inspector `9232` — see `wrangler.jsonc`)
- `deploy` — `wrangler deploy`
- `typegen` — `wrangler types` (regenerates `worker-configuration.d.ts`)
- `test` / `test:run` — Vitest (`@cloudflare/vitest-pool-workers`, with `AUTH_SERVICE` mocked in `vitest.config.mjs` — no real `worker-auth` instance needed to run these tests)
````

- [ ] **Step 2: Update `apps/worker-auth/CLAUDE.md`'s consumer note**

Find this sentence (currently the last line of the file):

```
`BETTER_AUTH_URL` is set to `worker-client`'s origin, not this worker's own — see the Testing section above.
```

And the paragraph above it that currently reads:

```
`worker-client` talks to this worker via a Cloudflare service binding (`AUTH_SERVICE` in `apps/worker-client/wrangler.jsonc`), proxying `/api/auth/*` requests through — see [docs/superpowers/specs/2026-08-27-client-auth-wiring-design.md](../../docs/superpowers/specs/2026-08-27-client-auth-wiring-design.md). `worker-realtime` is not wired up yet. See the [auth worker design spec](../../docs/superpowers/specs/2026-08-26-auth-worker-design.md) for what's deliberately deferred (roles/permissions design, wiring up consumers, additional identity providers, custom domain).
```

Replace that paragraph with:

```
`worker-client` talks to this worker via a Cloudflare service binding (`AUTH_SERVICE` in `apps/worker-client/wrangler.jsonc`), proxying `/api/auth/*` requests through — see [docs/superpowers/specs/2026-08-27-client-auth-wiring-design.md](../../docs/superpowers/specs/2026-08-27-client-auth-wiring-design.md). `worker-admin` talks to this worker the same way (its own `AUTH_SERVICE` binding) and additionally relies on the `admin` and `bearer` plugins configured here — see [apps/worker-admin/CLAUDE.md](../worker-admin/CLAUDE.md) and [docs/superpowers/specs/2026-09-12-worker-admin-design.md](../../docs/superpowers/specs/2026-09-12-worker-admin-design.md). `worker-realtime` is not wired up yet. See the [auth worker design spec](../../docs/superpowers/specs/2026-08-26-auth-worker-design.md) for what's still deferred (additional identity providers, custom domain) and the worker-admin spec for the roles/permissions/admin-UI follow-up.
```

Also add a line documenting the new env var. Find:

```
`worker-client` talks to this worker via a Cloudflare service binding
```

and insert a new paragraph directly before it:

```
`ADMIN_USER_IDS` (comma-separated Better Auth user ids) bootstraps the first admin account(s) — see the `admin` plugin config in `src/auth.ts` and [apps/worker-admin/CLAUDE.md](../worker-admin/CLAUDE.md).

```

- [ ] **Step 3: Add `apps/worker-admin` to the root `CLAUDE.md` monorepo map**

Find this line in `CLAUDE.md`:

```
- `apps/worker-auth` (`@capstone/auth`) — the identity worker: Google sign-in/sign-up and the OAuth provider other apps will link against. See [apps/worker-auth/CLAUDE.md](apps/worker-auth/CLAUDE.md).
```

Add directly after it:

```
- `apps/worker-admin` (`@capstone/admin`) — the admin worker: user management and role assignment, proxied through to `worker-auth`. See [apps/worker-admin/CLAUDE.md](apps/worker-admin/CLAUDE.md).
```

Also find:

```
The three apps are independent Cloudflare Workers deployed separately. `worker-client` talks to `worker-auth` via a service binding (`AUTH_SERVICE`, proxying `/api/auth/*`) — see [apps/worker-client/CLAUDE.md](apps/worker-client/CLAUDE.md) and [apps/worker-auth/CLAUDE.md](apps/worker-auth/CLAUDE.md). `worker-realtime` has no service bindings yet.
```

Replace with:

```
The four apps are independent Cloudflare Workers deployed separately. `worker-client` and `worker-admin` each talk to `worker-auth` via their own service binding (`AUTH_SERVICE`, proxying `/api/auth/*`) — see [apps/worker-client/CLAUDE.md](apps/worker-client/CLAUDE.md), [apps/worker-admin/CLAUDE.md](apps/worker-admin/CLAUDE.md), and [apps/worker-auth/CLAUDE.md](apps/worker-auth/CLAUDE.md). `worker-realtime` has no service bindings yet.
```

- [ ] **Step 4: Record a changeset**

Run from the repo root:

```bash
npm run changeset
```

In the interactive prompt: select both `@capstone/admin` and `@capstone/auth` (this pass adds a new workspace and changes `worker-auth`'s plugin config/env vars). Pick `minor` for `@capstone/admin` (first real version — it shipped with `0.0.0` in Task 1) and `patch` for `@capstone/auth` (additive plugin config, no breaking change to existing endpoints). Write a summary describing the new admin worker and the `admin`/`bearer` plugin additions. This creates one `.changeset/*.md` file — commit it alongside the docs.

- [ ] **Step 5: Commit**

```bash
git add apps/worker-admin/CLAUDE.md apps/worker-auth/CLAUDE.md CLAUDE.md .changeset
git commit -m "docs: document worker-admin and its worker-auth wiring"
```
