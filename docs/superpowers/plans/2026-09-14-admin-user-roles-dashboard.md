# Admin User Roles Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a three-tier role model (`admin` > `manager` > `user`) with real per-role access control to `worker-auth`, and a working dashboard in `worker-admin`'s SPA to sign in and manage users/roles with it.

**Architecture:** `worker-auth` gets a custom Better Auth access-control config (`ac`/roles) plus one small hook restricting what `manager` can do to `admin`-role targets. `worker-admin` gets a real sign-in flow: it round-trips through `worker-client`'s existing Google sign-in to obtain a bearer token (server-side, via a small rewrite in `worker-client`'s passthrough — a client-only capture doesn't work, see Task 3), then uses that token for a `adminClient()`-powered dashboard.

**Tech Stack:** Better Auth (`admin`, `bearer` plugins + `better-auth/plugins/access` for custom roles), Cloudflare Workers, Hono-free bare `ExportedHandler`s, React 19 + TanStack Router, Vitest (`@cloudflare/vitest-pool-workers`).

**Spec:** `docs/superpowers/specs/2026-09-14-admin-user-roles-dashboard-design.md`

## Global Constraints

- Biome formatting: 4-space indent, single quotes, no semicolons, no trailing commas, 140 col width — `npx biome check --write <file>` after editing, or rely on the pre-commit hook.
- No new runtime dependencies beyond what's already installed (`better-auth`, `@tanstack/react-router`) — every piece of this feature is built from existing packages' own exports.
- `worker-admin`'s existing `/api/auth/*` passthrough (`worker/index.ts`) is untouched by this plan — only `worker-client`'s passthrough gains logic (Task 3).
- Manager gets the same `ac` statement set as admin at the access-control layer; the "except admins" restriction is enforced entirely by the hook in Task 2, not by narrower `ac` statements (Better Auth's access-control model can't express target-state restrictions — see spec).
- An unrecognized `role` value fails safe: `hasPermission`'s `acRoles[role]?.authorize(...)` is `undefined` for any role not in the `roles` map, so it grants zero permissions. No extra Zod validation of `role` values is needed on top of that — the dashboard's own `<select>` only ever offers the three known values anyway.

---

## Task 1: `worker-auth` — role & access-control model

**Files:**
- Create: `apps/worker-auth/src/access-control.ts`
- Modify: `apps/worker-auth/src/auth.ts`
- Modify: `apps/worker-auth/test/admin.test.ts`

**Interfaces:**
- Produces: `apps/worker-auth/src/access-control.ts` exports `ac` (an `AccessControl` from `createAccessControl`), and three roles: `adminRole`, `managerRole`, `userRole` (each a `Role` from `ac.newRole(...)`).
- Consumes (Task 2): Task 2 imports `apps/worker-auth/src/auth.ts`'s exported `createAuth` is unchanged in shape; Task 2 adds a new plugin to the `plugins` array already present there.

- [ ] **Step 1: Write the failing test for the access-control module in isolation**

Create `apps/worker-auth/test/access-control.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { adminRole, managerRole, userRole } from '../src/access-control'

describe('access-control roles', () => {
    it('lets admin list, set-role, ban, and delete users', () => {
        expect(adminRole.authorize({ user: ['list'] }).success).toBe(true)
        expect(adminRole.authorize({ user: ['set-role'] }).success).toBe(true)
        expect(adminRole.authorize({ user: ['ban'] }).success).toBe(true)
        expect(adminRole.authorize({ user: ['delete'] }).success).toBe(true)
    })

    it('lets manager list, set-role, ban, and delete users too', () => {
        expect(managerRole.authorize({ user: ['list'] }).success).toBe(true)
        expect(managerRole.authorize({ user: ['set-role'] }).success).toBe(true)
        expect(managerRole.authorize({ user: ['ban'] }).success).toBe(true)
        expect(managerRole.authorize({ user: ['delete'] }).success).toBe(true)
    })

    it('gives user no admin-plugin permissions', () => {
        expect(userRole.authorize({ user: ['list'] }).success).toBe(false)
        expect(userRole.authorize({ user: ['set-role'] }).success).toBe(false)
    })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -w @capstone/auth -- access-control`
Expected: FAIL — `Cannot find module '../src/access-control'`

- [ ] **Step 3: Write the access-control module**

Create `apps/worker-auth/src/access-control.ts`:

```ts
import { createAccessControl } from 'better-auth/plugins/access'

// Matches Better Auth's own built-in `adminAc` statement set
// (node_modules/better-auth/dist/plugins/admin/access/statement.mjs) — admin keeps every
// capability it already had before this module existed, nothing is silently dropped.
const statement = {
    user: [
        'create',
        'list',
        'set-role',
        'ban',
        'impersonate',
        'impersonate-admins',
        'delete',
        'set-password',
        'set-email',
        'get',
        'update'
    ],
    session: ['list', 'revoke', 'delete']
} as const

export const ac = createAccessControl(statement)

export const adminRole = ac.newRole({
    user: ['create', 'list', 'set-role', 'ban', 'impersonate', 'delete', 'set-password', 'set-email', 'get', 'update'],
    session: ['list', 'revoke', 'delete']
})

// Same action set as admin at the ac layer — the "manager can't touch admin accounts or grant
// the admin role" restriction is target-state-aware and can't be expressed here. See
// manager-restrictions.ts.
export const managerRole = ac.newRole({
    user: ['list', 'set-role', 'ban', 'delete']
})

export const userRole = ac.newRole({
    user: [],
    session: []
})
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:run -w @capstone/auth -- access-control`
Expected: PASS

- [ ] **Step 5: Wire the roles into the `admin` plugin config**

Read `apps/worker-auth/src/auth.ts` first to confirm the current `admin({...})` call (it's at the `plugins:` array, currently `admin({ adminUserIds: ... })`). Modify it:

```ts
import { admin, bearer, jwt } from 'better-auth/plugins'
```

becomes

```ts
import { admin, bearer, jwt } from 'better-auth/plugins'
import { ac, adminRole, managerRole, userRole } from './access-control'
```

and the `admin({...})` call gains `ac` and `roles`:

```ts
admin({
    ac,
    roles: { admin: adminRole, manager: managerRole, user: userRole },
    // adminUserIds bootstraps the first admin account(s) without a manual DB write
    // or an existing admin to grant the role — any user whose id is listed here is
    // treated as an admin regardless of their `role` column (confirmed against
    // node_modules/better-auth/dist/plugins/admin/has-permission.mjs). Comma-separated
    // Better Auth user ids; further admins get promoted via /admin/set-role instead.
    adminUserIds:
        env.ADMIN_USER_IDS?.split(',')
            .map(id => id.trim())
            .filter(Boolean) ?? []
}),
```

- [ ] **Step 6: Add the role-matrix tests to `test/admin.test.ts`**

Append to `apps/worker-auth/test/admin.test.ts` (inside the existing `describe('admin plugin', ...)` block, reusing the file's existing `signInWithGoogle`/`userIdForEmail` helpers):

```ts
it('lets a manager list users, change a non-admin role, ban/unban, and remove a non-admin', async ({ expect }) => {
    const managerCookie = await signInWithGoogle({ sub: 'google-20', email: 'mia@example.com', name: 'Mia' })
    const managerId = await userIdForEmail('mia@example.com')
    await callAsApp(
        new Request('https://example.com/api/auth/admin/set-role', {
            method: 'POST',
            headers: { cookie: managerCookie, origin: 'https://example.com', 'content-type': 'application/json' },
            body: JSON.stringify({ userId: managerId, role: 'manager' })
        }),
        { ADMIN_USER_IDS: managerId }
    )
    // re-sign-in so the session reflects the freshly-set role
    const freshManagerCookie = await signInWithGoogle({ sub: 'google-20', email: 'mia@example.com', name: 'Mia' })

    await signInWithGoogle({ sub: 'google-21', email: 'noah@example.com', name: 'Noah' })
    const targetId = await userIdForEmail('noah@example.com')

    const setRoleResponse = await callAsApp(
        new Request('https://example.com/api/auth/admin/set-role', {
            method: 'POST',
            headers: { cookie: freshManagerCookie, origin: 'https://example.com', 'content-type': 'application/json' },
            body: JSON.stringify({ userId: targetId, role: 'manager' })
        }),
        { ADMIN_USER_IDS: '' }
    )
    expect(setRoleResponse.status).toBe(200)

    const banResponse = await callAsApp(
        new Request('https://example.com/api/auth/admin/ban-user', {
            method: 'POST',
            headers: { cookie: freshManagerCookie, origin: 'https://example.com', 'content-type': 'application/json' },
            body: JSON.stringify({ userId: targetId })
        }),
        { ADMIN_USER_IDS: '' }
    )
    expect(banResponse.status).toBe(200)
})

it('rejects a plain user on every admin endpoint', async ({ expect }) => {
    const cookie = await signInWithGoogle({ sub: 'google-22', email: 'zara@example.com', name: 'Zara' })
    const response = await callAsApp(new Request('https://example.com/api/auth/admin/list-users?limit=10', { headers: { cookie } }), {
        ADMIN_USER_IDS: ''
    })
    expect(response.status).toBe(403)
})
```

- [ ] **Step 7: Regenerate the schema and confirm no destructive diff**

Run:

```bash
cd apps/worker-auth
npx auth@1.7.1 generate --config ./auth.cli.ts --adapter drizzle --dialect sqlite --output src/db/schema.ts -y
git diff src/db/schema.ts
```

Expected: no diff (the `ac`/`roles` config is behavior-only, not schema). If there is a diff, it must be purely additive (per `apps/worker-auth/CLAUDE.md`'s existing warning about `auth@latest` schema drift) — stop and re-check the generated version if it looks destructive.

- [ ] **Step 8: Run the full worker-auth test suite**

Run: `npm run test:run -w @capstone/auth`
Expected: PASS (all existing tests plus the new ones)

- [ ] **Step 9: Commit**

```bash
git add apps/worker-auth/src/access-control.ts apps/worker-auth/src/auth.ts apps/worker-auth/test/admin.test.ts apps/worker-auth/src/db/schema.ts
git commit -m "feat(auth): add admin/manager/user access-control model"
```

---

## Task 2: `worker-auth` — manager can't touch admin accounts

**Files:**
- Create: `apps/worker-auth/src/manager-restrictions.ts`
- Modify: `apps/worker-auth/src/auth.ts`
- Modify: `apps/worker-auth/test/admin.test.ts`

**Interfaces:**
- Consumes: nothing new from Task 1 beyond the `role` column values already in play (`'admin'`, `'manager'`, `'user'`).
- Produces: `apps/worker-auth/src/manager-restrictions.ts` exports `managerRestrictions`, a `BetterAuthPlugin` added to `createAuth`'s `plugins` array.

- [ ] **Step 1: Write the failing tests**

Append to `apps/worker-auth/test/admin.test.ts`:

```ts
async function setRole(actorCookie: string, targetUserId: string, role: string, adminUserIds = '') {
    return callAsApp(
        new Request('https://example.com/api/auth/admin/set-role', {
            method: 'POST',
            headers: { cookie: actorCookie, origin: 'https://example.com', 'content-type': 'application/json' },
            body: JSON.stringify({ userId: targetUserId, role })
        }),
        { ADMIN_USER_IDS: adminUserIds }
    )
}

it('rejects a manager trying to grant the admin role', async ({ expect }) => {
    const bootstrapCookie = await signInWithGoogle({ sub: 'google-30', email: 'lena@example.com', name: 'Lena' })
    const bootstrapId = await userIdForEmail('lena@example.com')
    await setRole(bootstrapCookie, bootstrapId, 'manager', bootstrapId)
    const managerCookie = await signInWithGoogle({ sub: 'google-30', email: 'lena@example.com', name: 'Lena' })

    await signInWithGoogle({ sub: 'google-31', email: 'omar2@example.com', name: 'Omar' })
    const targetId = await userIdForEmail('omar2@example.com')

    const response = await setRole(managerCookie, targetId, 'admin')
    expect(response.status).toBe(403)
})

it('rejects a manager acting on a user who is currently admin', async ({ expect }) => {
    const adminCookie = await signInWithGoogle({ sub: 'google-32', email: 'wei@example.com', name: 'Wei' })
    const adminId = await userIdForEmail('wei@example.com')

    const managerCookie = await signInWithGoogle({ sub: 'google-33', email: 'ana@example.com', name: 'Ana' })
    const managerId = await userIdForEmail('ana@example.com')
    await setRole(adminCookie, managerId, 'manager', adminId)
    const freshManagerCookie = await signInWithGoogle({ sub: 'google-33', email: 'ana@example.com', name: 'Ana' })

    const response = await setRole(freshManagerCookie, adminId, 'manager', '')
    expect(response.status).toBe(403)

    const banResponse = await callAsApp(
        new Request('https://example.com/api/auth/admin/ban-user', {
            method: 'POST',
            headers: { cookie: freshManagerCookie, origin: 'https://example.com', 'content-type': 'application/json' },
            body: JSON.stringify({ userId: adminId })
        }),
        { ADMIN_USER_IDS: '' }
    )
    expect(banResponse.status).toBe(403)
})

it('still lets an admin act on another admin', async ({ expect }) => {
    const adminCookie = await signInWithGoogle({ sub: 'google-34', email: 'tom@example.com', name: 'Tom' })
    const adminId = await userIdForEmail('tom@example.com')

    await signInWithGoogle({ sub: 'google-35', email: 'ivy@example.com', name: 'Ivy' })
    const otherAdminId = await userIdForEmail('ivy@example.com')
    await setRole(adminCookie, otherAdminId, 'admin', adminId)

    const response = await setRole(adminCookie, otherAdminId, 'manager', adminId)
    expect(response.status).toBe(200)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:run -w @capstone/auth -- admin`
Expected: FAIL — the "rejects a manager..." tests currently get `200`, not `403` (no restriction exists yet).

- [ ] **Step 3: Write the restriction plugin**

Create `apps/worker-auth/src/manager-restrictions.ts`:

```ts
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'
import type { BetterAuthPlugin } from 'better-auth'

const RESTRICTED_PATHS = new Set(['/admin/set-role', '/admin/ban-user', '/admin/unban-user', '/admin/remove-user'])

// The `admin` plugin's access-control model (access-control.ts) only checks what the *actor's*
// role can do, never the *target's* current role or the requested value — so "manager can't
// grant admin" and "manager can't touch an admin account" both have to be enforced here instead.
export const managerRestrictions = {
    id: 'manager-restrictions',
    hooks: {
        before: [
            {
                matcher: context => RESTRICTED_PATHS.has(context.path),
                handler: createAuthMiddleware(async ctx => {
                    const session = await getSessionFromCtx(ctx)
                    if (!session || session.user.role !== 'manager') return

                    if (ctx.path === '/admin/set-role' && ctx.body?.role === 'admin') {
                        throw new APIError('FORBIDDEN', { message: 'Managers cannot grant the admin role.' })
                    }

                    const targetUserId = ctx.body?.userId as string | undefined
                    if (!targetUserId) return
                    const targetUser = await ctx.context.internalAdapter.findUserById(targetUserId)
                    if (targetUser && (targetUser as { role?: string }).role === 'admin') {
                        throw new APIError('FORBIDDEN', { message: 'Managers cannot act on admin accounts.' })
                    }
                })
            }
        ]
    }
} satisfies BetterAuthPlugin
```

- [ ] **Step 4: Wire the plugin into `auth.ts`**

Add the import and register it in the `plugins` array (after `admin(...)`, before or after `bearer()` — order doesn't matter here since it only reads session state, it doesn't rewrite headers):

```ts
import { managerRestrictions } from './manager-restrictions'
```

```ts
plugins: [
    jwt(),
    oauthProvider({ loginPage: '/login', consentPage: '/consent' }),
    admin({ ... }),
    managerRestrictions,
    bearer()
]
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:run -w @capstone/auth -- admin`
Expected: PASS

- [ ] **Step 6: Run the full worker-auth test suite**

Run: `npm run test:run -w @capstone/auth`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/worker-auth/src/manager-restrictions.ts apps/worker-auth/src/auth.ts apps/worker-auth/test/admin.test.ts
git commit -m "feat(auth): block managers from granting admin or acting on admin accounts"
```

---

## Task 3: `worker-client` — capture the bearer token on the OAuth callback

**Files:**
- Modify: `apps/worker-client/worker/index.ts`
- Modify: `apps/worker-client/package.json`
- Create: `apps/worker-client/vitest.config.mjs`
- Create: `apps/worker-client/test/index.test.ts`

**Interfaces:**
- Produces: for any response to `/api/auth/callback/google` whose `Location` header's target has a `returnTo` query param and whose `set-auth-token` header is present, the rewritten `Location` header gains a `#token=<value>` fragment. Every other response (including callbacks with no `returnTo`) passes through byte-for-byte unchanged, matching the current behavior.

- [ ] **Step 1: Add Vitest + workers-pool test tooling to `worker-client`'s `package.json`**

`worker-client` has no test runner today (unlike `worker-auth`/`worker-admin`, which both already use `@cloudflare/vitest-pool-workers` — mirror `apps/worker-admin/package.json`'s versions exactly). Modify `apps/worker-client/package.json`:

```json
"scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "lint": "biome check .",
    "preview": "npm run build && vite preview",
    "deploy": "npm run build && wrangler deploy",
    "cf-typegen": "wrangler types",
    "test": "vitest",
    "test:run": "vitest run"
},
```

and add to `devDependencies` (alongside the existing entries, matching `apps/worker-admin/package.json`'s pinned versions):

```json
"@cloudflare/vitest-pool-workers": "^0.22.0",
"@cloudflare/workers-types": "^5.20260826.1",
"vitest": "^4.1.11",
```

Then run `npm install` from the repo root so the lockfile picks up the new devDependencies for this workspace.

- [ ] **Step 2: Write the failing tests**

Create `apps/worker-client/test/index.test.ts`:

```ts
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { it } from 'vitest'
import app from '../worker/index'

it('appends the bearer token as a fragment when the callback redirect carries a returnTo param', async ({ expect }) => {
    const ctx = createExecutionContext()
    const response = await app.fetch(new Request('https://example.com/api/auth/callback/google?code=test&state=test'), env, ctx)
    await waitOnExecutionContext(ctx)

    expect(response.headers.get('location')).toBe('https://example.com/login?returnTo=http%3A%2F%2Flocalhost%3A8790%2Fauth-callback#token=test-token')
})

it('leaves the callback redirect untouched when there is no returnTo param', async ({ expect }) => {
    const ctx = createExecutionContext()
    const response = await app.fetch(new Request('https://example.com/api/auth/callback/google?code=plain&state=plain'), env, ctx)
    await waitOnExecutionContext(ctx)

    expect(response.headers.get('location')).toBe('https://example.com/')
})

it('forwards other /api/auth/* requests untouched', async ({ expect }) => {
    const ctx = createExecutionContext()
    const response = await app.fetch(new Request('https://example.com/api/auth/get-session'), env, ctx)
    await waitOnExecutionContext(ctx)

    expect(response.status).toBe(200)
})

it('404s any request outside /api/auth/*', async ({ expect }) => {
    const ctx = createExecutionContext()
    const response = await app.fetch(new Request('https://example.com/whatever'), env, ctx)
    await waitOnExecutionContext(ctx)

    expect(response.status).toBe(404)
})
```

Create `apps/worker-client/vitest.config.mjs` (mirrors `apps/worker-admin/vitest.config.mjs`, with a mock `AUTH_SERVICE` that fabricates the three response shapes the tests above need):

```js
import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
    plugins: [
        cloudflareTest({
            wrangler: { configPath: './wrangler.jsonc' },
            miniflare: {
                serviceBindings: {
                    AUTH_SERVICE(request) {
                        const url = new URL(request.url)
                        if (url.pathname === '/api/auth/callback/google' && url.searchParams.get('code') === 'test') {
                            return new Response(null, {
                                status: 302,
                                headers: {
                                    location: 'https://example.com/login?returnTo=http%3A%2F%2Flocalhost%3A8790%2Fauth-callback',
                                    'set-auth-token': 'test-token'
                                }
                            })
                        }
                        if (url.pathname === '/api/auth/callback/google') {
                            return new Response(null, {
                                status: 302,
                                headers: { location: 'https://example.com/', 'set-auth-token': 'test-token' }
                            })
                        }
                        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
                    }
                }
            }
        })
    ]
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm run test:run -w @capstone/client`
Expected: FAIL — the two callback-specific assertions fail (`location` is unmodified today since the passthrough doesn't rewrite anything yet).

- [ ] **Step 4: Implement the rewrite**

Modify `apps/worker-client/worker/index.ts`:

```ts
export default {
    async fetch(request, env) {
        const url = new URL(request.url)

        if (url.pathname.startsWith('/api/auth/')) {
            const response = await env.AUTH_SERVICE.fetch(request)

            if (url.pathname === '/api/auth/callback/google') {
                const token = response.headers.get('set-auth-token')
                const location = response.headers.get('location')
                if (token && location) {
                    const redirectUrl = new URL(location, url.origin)
                    if (redirectUrl.searchParams.has('returnTo')) {
                        redirectUrl.hash = `token=${encodeURIComponent(token)}`
                        const headers = new Headers(response.headers)
                        headers.set('location', redirectUrl.toString())
                        return new Response(response.body, { status: response.status, headers })
                    }
                }
            }

            return response
        }

        return new Response(null, { status: 404 })
    }
} satisfies ExportedHandler<Env>
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:run -w @capstone/client`
Expected: PASS

- [ ] **Step 6: Regenerate types and lint**

Run: `npm run cf-typegen -w @capstone/client && npm run lint -w @capstone/client`
Expected: no errors (the `env` parameter's type comes from `worker-configuration.d.ts`, already covers `AUTH_SERVICE`, no new bindings added).

- [ ] **Step 7: Commit**

```bash
git add apps/worker-client/worker/index.ts apps/worker-client/package.json apps/worker-client/vitest.config.mjs apps/worker-client/test/index.test.ts package-lock.json
git commit -m "feat(client): capture the bearer token on the OAuth callback for worker-admin"
```

---

## Task 4: `worker-client` — `/login` round-trip UI

**Files:**
- Modify: `apps/worker-client/src/routes/login.tsx`

**Interfaces:**
- Consumes: nothing new — reuses the existing `authClient` from `apps/worker-client/src/lib/auth-client.ts`, and Task 3's `Location`-header rewrite (already shipped by the time a real browser reaches this route).
- Produces: when `worker-client`'s `/login?returnTo=<url>` is visited with a `#token=<value>` fragment already present (put there by Task 3's rewrite) and `returnTo` passes the allowlist check, the browser is redirected to `<returnTo>#token=<value>`.

- [ ] **Step 1: Modify the route**

Read `apps/worker-client/src/routes/login.tsx` first (current content shown in the spec's Context — a bare `createFileRoute('/login')` with one button). Replace it with:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'
import { authClient } from '../lib/auth-client'

// worker-admin's origin(s) allowed to receive a bearer token via this round-trip. A bearer
// token is a live credential, so this list must stay an explicit allowlist, never a
// pattern/prefix check that could be satisfied by an attacker-controlled host.
const ALLOWED_RETURN_ORIGINS = ['http://localhost:8790']

function isAllowedReturnTo(returnTo: string) {
    return ALLOWED_RETURN_ORIGINS.some(origin => returnTo === origin || returnTo.startsWith(`${origin}/`))
}

export const Route = createFileRoute('/login')({
    validateSearch: (search: Record<string, unknown>): { returnTo?: string } => ({
        returnTo: typeof search.returnTo === 'string' ? search.returnTo : undefined
    }),
    component: LoginRoute
})

function LoginRoute() {
    const { returnTo } = Route.useSearch()

    useEffect(() => {
        if (!returnTo || !isAllowedReturnTo(returnTo)) return
        if (!window.location.hash.startsWith('#token=')) return
        window.location.href = `${returnTo}${window.location.hash}`
    }, [returnTo])

    return (
        <div className="p-2">
            <h3>Sign in</h3>
            <button
                type="button"
                onClick={() =>
                    authClient.signIn.social({
                        provider: 'google',
                        callbackURL: returnTo ? `/login?returnTo=${encodeURIComponent(returnTo)}` : '/'
                    })
                }
            >
                Sign in with Google
            </button>
        </div>
    )
}
```

- [ ] **Step 2: Manual verification (no frontend component test runner exists for this repo — see spec's Testing section)**

Run `npm run dev -w @capstone/client` and `npm run dev -w @capstone/auth` together (both need to be running — `worker-client` proxies to `worker-auth` via the service binding). Visit `http://localhost:5173/login?returnTo=http://localhost:8790/auth-callback`, click "Sign in with Google" (uses the mocked/real Google flow per existing dev setup), and confirm the browser ends up navigating toward `http://localhost:8790/auth-callback#token=...` (Task 6 makes that destination route exist — until then, expect a 404 there, which still proves the token made it across).

- [ ] **Step 3: Lint**

Run: `npm run lint -w @capstone/client`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add apps/worker-client/src/routes/login.tsx
git commit -m "feat(client): forward a returned bearer token to worker-admin on /login"
```

---

## Task 5: `worker-admin` — sign-in plumbing

**Files:**
- Create: `apps/worker-admin/src/lib/auth-client.ts`
- Create: `apps/worker-admin/src/routes/login.tsx`
- Create: `apps/worker-admin/src/routes/auth-callback.tsx`
- Modify: `apps/worker-admin/package.json`

**Interfaces:**
- Produces: `apps/worker-admin/src/lib/auth-client.ts` exports `authClient` (a `better-auth/react` client with `adminClient()` and a global bearer-token `fetchOptions.auth`, reading from `sessionStorage.getItem('admin_token')`). Task 6 imports this.
- Consumes: Task 4's `worker-client` `/login?returnTo=...` round-trip.

- [ ] **Step 1: Add `better-auth` as a dependency**

`worker-admin`'s `package.json` currently has no `better-auth` dependency (unlike `worker-client`, which already has `"better-auth": "^1.7.1"`). Modify `apps/worker-admin/package.json`'s `dependencies`:

```json
"dependencies": {
    "@tanstack/react-router": "^1.170.31",
    "@tanstack/react-router-devtools": "^1.167.1",
    "better-auth": "^1.7.1",
    "react": "^19.2.8",
    "react-dom": "^19.2.8"
},
```

Run `npm install` from the repo root afterward.

- [ ] **Step 2: Write the auth client**

Create `apps/worker-admin/src/lib/auth-client.ts`:

```ts
import { adminClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

const TOKEN_STORAGE_KEY = 'admin_token'

export function getStoredToken() {
    try {
        return sessionStorage.getItem(TOKEN_STORAGE_KEY) ?? undefined
    } catch {
        return undefined
    }
}

export function storeToken(token: string) {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, token)
}

export const authClient = createAuthClient({
    plugins: [adminClient()],
    fetchOptions: {
        auth: {
            type: 'Bearer',
            token: getStoredToken
        }
    }
})
```

- [ ] **Step 3: Write the `/login` route**

Create `apps/worker-admin/src/routes/login.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'

// worker-client's dev origin — the one place the sign-in round-trip starts (see
// docs/superpowers/specs/2026-09-14-admin-user-roles-dashboard-design.md).
const CLIENT_ORIGIN = 'http://localhost:5173'

export const Route = createFileRoute('/login')({
    component: LoginRoute
})

function LoginRoute() {
    const returnTo = `${window.location.origin}/auth-callback`
    const signInUrl = `${CLIENT_ORIGIN}/login?returnTo=${encodeURIComponent(returnTo)}`

    return (
        <div className="p-2">
            <h3>Sign in</h3>
            <a href={signInUrl}>Sign in with Google</a>
        </div>
    )
}
```

- [ ] **Step 4: Write the `/auth-callback` route**

Create `apps/worker-admin/src/routes/auth-callback.tsx`:

```tsx
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { storeToken } from '../lib/auth-client'

export const Route = createFileRoute('/auth-callback')({
    component: AuthCallbackRoute
})

function AuthCallbackRoute() {
    const navigate = useNavigate()

    useEffect(() => {
        const match = window.location.hash.match(/^#token=(.+)$/)
        if (!match) {
            navigate({ to: '/login' })
            return
        }
        storeToken(decodeURIComponent(match[1]))
        navigate({ to: '/' })
    }, [navigate])

    return <p className="p-2">Signing in…</p>
}
```

- [ ] **Step 5: Regenerate the route tree**

Run `npm run dev -w @capstone/admin`, wait for the startup log to show it has picked up the new route files (the TanStack Router Vite plugin regenerates `src/routeTree.gen.ts` from `src/routes/` on start/file-change, same as it already does for the existing `/` and `__root` routes), then stop it (Ctrl+C). Confirm `src/routeTree.gen.ts` now references `/login` and `/auth-callback`.

- [ ] **Step 6: Manual verification**

With Task 4's manual check still in place, run `worker-client`'s and `worker-auth`'s dev servers plus `npm run dev -w @capstone/admin`, repeat the `http://localhost:8790/login` → sign-in → round-trip flow, and confirm it lands on `worker-admin`'s `/` with `sessionStorage.getItem('admin_token')` populated (check via devtools).

- [ ] **Step 7: Lint**

Run: `npm run lint -w @capstone/admin`
Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add apps/worker-admin/package.json apps/worker-admin/src/lib/auth-client.ts apps/worker-admin/src/routes/login.tsx apps/worker-admin/src/routes/auth-callback.tsx apps/worker-admin/src/routeTree.gen.ts package-lock.json
git commit -m "feat(admin): add sign-in round-trip (login, auth-callback, auth client)"
```

---

## Task 6: `worker-admin` — dashboard UI

**Files:**
- Modify: `apps/worker-admin/src/routes/index.tsx`

**Interfaces:**
- Consumes: `apps/worker-admin/src/lib/auth-client.ts`'s `authClient` (Task 5) — specifically `authClient.useSession()`, `authClient.admin.listUsers()`, `.setRole()`, `.banUser()`, `.unbanUser()`, `.removeUser()`, and `getStoredToken` for the auth guard.

- [ ] **Step 1: Replace the placeholder route**

Modify `apps/worker-admin/src/routes/index.tsx` (currently just `<h3>Admin</h3>` — see Task 5's context):

```tsx
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { authClient, getStoredToken } from '../lib/auth-client'

type ManagedUser = {
    id: string
    email: string
    role?: string | null
    banned?: boolean | null
}

const ROLE_OPTIONS = ['user', 'manager', 'admin'] as const

export const Route = createFileRoute('/')({
    beforeLoad: () => {
        if (!getStoredToken()) throw redirect({ to: '/login' })
    },
    component: DashboardRoute
})

function DashboardRoute() {
    const { data: session } = authClient.useSession()
    const [users, setUsers] = useState<ManagedUser[] | null>(null)
    const [loadError, setLoadError] = useState<string | null>(null)

    const viewerRole = session?.user.role ?? 'user'

    useEffect(() => {
        if (viewerRole === 'user') return
        authClient.admin.listUsers({ query: { limit: 100 } }).then(({ data, error }) => {
            if (error) {
                setLoadError(error.message ?? 'Failed to load users')
                return
            }
            setUsers((data?.users as ManagedUser[]) ?? [])
        })
    }, [viewerRole])

    if (viewerRole === 'user') {
        return (
            <div className="p-2">
                <h3>Access denied</h3>
                <p>Your account doesn't have admin or manager access.</p>
            </div>
        )
    }

    async function changeRole(userId: string, role: string) {
        const { error } = await authClient.admin.setRole({ userId, role })
        if (error) {
            setLoadError(error.message ?? 'Failed to change role')
            return
        }
        setUsers(current => current?.map(user => (user.id === userId ? { ...user, role } : user)) ?? null)
    }

    async function toggleBan(user: ManagedUser) {
        const action = user.banned ? authClient.admin.unbanUser : authClient.admin.banUser
        const { error } = await action({ userId: user.id })
        if (error) {
            setLoadError(error.message ?? 'Failed to update ban status')
            return
        }
        setUsers(current => current?.map(u => (u.id === user.id ? { ...u, banned: !u.banned } : u)) ?? null)
    }

    async function removeUser(userId: string) {
        const { error } = await authClient.admin.removeUser({ userId })
        if (error) {
            setLoadError(error.message ?? 'Failed to remove user')
            return
        }
        setUsers(current => current?.filter(u => u.id !== userId) ?? null)
    }

    const grantableRoles = viewerRole === 'admin' ? ROLE_OPTIONS : ROLE_OPTIONS.filter(role => role !== 'admin')

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
                        return (
                            <tr key={user.id}>
                                <td>{user.email}</td>
                                <td>
                                    <select
                                        value={user.role ?? 'user'}
                                        disabled={lockedForViewer}
                                        onChange={event => changeRole(user.id, event.target.value)}
                                    >
                                        {grantableRoles.map(role => (
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

- [ ] **Step 2: Manual verification**

With all dev servers running and at least one bootstrap admin set via `ADMIN_USER_IDS` (per `apps/worker-auth/CLAUDE.md`), repeat the full sign-in round-trip and confirm: the user table loads, changing a role via the `<select>` persists (reload the page and re-check), ban/unban and remove work, and a `manager` viewer never sees `admin` as a selectable role and can't act on a row whose role is `admin`. This is the plan's one full end-to-end manual pass called for in the spec's Testing section.

- [ ] **Step 3: Lint**

Run: `npm run lint -w @capstone/admin`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add apps/worker-admin/src/routes/index.tsx
git commit -m "feat(admin): add user management dashboard"
```

---

## Task 7: Docs and versioning

**Files:**
- Modify: `apps/worker-auth/CLAUDE.md`
- Modify: `apps/worker-admin/CLAUDE.md`
- Modify: `apps/worker-client/CLAUDE.md`

**Interfaces:** none — documentation and release bookkeeping only.

- [ ] **Step 1: Update `apps/worker-auth/CLAUDE.md`**

Add a short note (near the existing `admin` plugin / `ADMIN_USER_IDS` section) documenting: the `access-control.ts` module and its three roles, the `manager-restrictions.ts` hook and what it blocks, and that `manager` is granted the same `role` column mechanism as `admin` (just a different string value).

- [ ] **Step 2: Update `apps/worker-admin/CLAUDE.md`**

Replace the "Calling the API directly" curl-only section with a description of the real sign-in flow (Tasks 4-6): the `/login` → `worker-client` round-trip → `/auth-callback` → dashboard flow, and that the curl workflow still works as a fallback for scripting/debugging.

- [ ] **Step 3: Update `apps/worker-client/CLAUDE.md`**

Add a note to the `worker/index.ts` passthrough description: it now also rewrites the OAuth callback's `Location` header to append a bearer token fragment when the redirect target carries a `returnTo` param, for `worker-admin`'s sign-in round-trip — link to the spec.

- [ ] **Step 4: Run the changeset**

Run `npm run changeset` from the repo root. Select `@capstone/auth` (minor — new access-control model), `@capstone/admin` (minor — new sign-in flow and dashboard), and `@capstone/client` (patch — new round-trip logic on `/login`). Write summaries describing each change.

- [ ] **Step 5: Commit**

```bash
git add apps/worker-auth/CLAUDE.md apps/worker-admin/CLAUDE.md apps/worker-client/CLAUDE.md .changeset
git commit -m "docs: document the admin roles/dashboard feature and record changesets"
```

---

## Final check

Run the full build/lint/type-check/test suite from the repo root before opening a PR:

```bash
npm run lint
npm run check-types
npm run test:run -w @capstone/auth
npm run test:run -w @capstone/client
npm run test:run -w @capstone/admin
npm run build
```

All should pass with no errors.
