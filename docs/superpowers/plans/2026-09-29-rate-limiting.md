# Rate limiting for worker-oidc Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn on real, atomic, D1-backed request-rate limiting on `apps/worker-oidc`'s anonymous/credential-guessing surface (sign-in, password-reset request, password-reset token redemption, invite-token redemption), which is currently unprotected — Better Auth's built-in limiter has never actually been enabled in this deployment.

**Architecture:** Enable Better Auth's own `rateLimit: { storage: 'database' }` (reuses the existing `OIDC_DB` D1 binding via Drizzle, atomic conditional `UPDATE`) for everything under `/api/auth/*`, add one custom rule for `/reset-password` (not covered by Better Auth's own defaults), and add one small hand-rolled middleware — reusing the same `rate_limit` table — for `POST /api/invites/accept`, which sits outside Better Auth's handler entirely.

**Tech Stack:** Better Auth `^1.7.1`, Drizzle ORM (`drizzle-orm/d1`), Cloudflare D1, Hono, Vitest via `@cloudflare/vitest-pool-workers`.

**Spec:** `docs/superpowers/specs/2026-09-29-rate-limiting-design.md`

## Global Constraints

- Reuse the existing `OIDC_DB` D1 binding via the existing Drizzle adapter — no new Cloudflare binding (KV, Durable Object, or otherwise).
- `rateLimit.storage` must be `'database'`, never `'memory'` or `'secondary-storage'`.
- `advanced.ipAddress.ipAddressHeaders` must be `['cf-connecting-ip']` — not Better Auth's default `x-forwarded-for`.
- `/reset-password` custom rule: window `60` seconds, max `5`.
- `POST /api/invites/accept` hand-rolled limiter: window `60` seconds, max `5`.
- `/internal/*` and `/api/admin/*` are explicitly out of scope for this change — do not add rate limiting there.
- Both mechanisms (Better Auth's own, and the hand-rolled one) write into the **same** `rate_limit` table — do not create a second table.
- Test files stay under `test/`, never colocated under `worker/`.
- `npm run changeset` at the end, targeting `@capstone/openid-connect` only, minor bump.

## Review Focus

- A key that trips the limit must be usable again once its window has elapsed — a bug in the reset branch could permanently lock a key out. Covered in Task 1.
- The rate-limit key must be scoped per-path as well as per-IP — a user's failed sign-in attempts must not also block their unrelated password-reset request from the same IP. Covered in Task 1.
- A request with no resolvable client IP (header missing or stripped) must still be rate-limited via the shared fallback bucket, not silently pass through unlimited. Covered in Task 3.
- Concurrent requests arriving at the count-equals-max boundary must not all succeed — this is the entire reason a non-atomic store (Workers KV) was rejected in the spec, so the atomicity claim needs a real concurrent test, not just sequential ones. Covered in Task 3.
- The hand-rolled `/api/invites/accept` middleware must rate-limit before the route handler's own body parsing runs, so a malformed/garbage JSON body doesn't let an attacker dodge the limiter. Covered in Task 3.

---

## File Structure

- **Modify** `apps/worker-oidc/worker/auth.ts` — add `rateLimit` and `advanced.ipAddress` config to the existing `betterAuth({...})` call (Task 1, Task 2).
- **Modify** `apps/worker-oidc/worker/db/schema.ts` — hand-add the `rateLimit` table export (Task 1).
- **Create** `apps/worker-oidc/drizzle/<generated>.sql` — via `drizzle-kit generate` (Task 1).
- **Modify** `apps/worker-oidc/test/helpers/call-app.ts` — synthetic per-call `cf-connecting-ip` header (Task 1).
- **Create** `apps/worker-oidc/worker/rate-limit.ts` — `consumeRateLimit` + `registerInviteAcceptRateLimit` (Task 3).
- **Modify** `apps/worker-oidc/worker/index.ts` — wire `registerInviteAcceptRateLimit` onto `/api/invites/accept` (Task 3).
- **Create** `apps/worker-oidc/test/rate-limit.test.ts` — all test cases, grown across Tasks 1–3.
- **Modify** `apps/worker-oidc/CLAUDE.md` — new "## Rate limiting" section, file-list bullets (Task 4).
- **Create** `.changeset/rate-limiting.md` (Task 4).

---

### Task 1: Enable database-backed rate limiting for `/api/auth/*`

**Files:**
- Modify: `apps/worker-oidc/worker/auth.ts`
- Modify: `apps/worker-oidc/worker/db/schema.ts`
- Create: `apps/worker-oidc/drizzle/<generated>.sql` (via `drizzle-kit generate`, filename picked by the tool)
- Modify: `apps/worker-oidc/test/helpers/call-app.ts`
- Create: `apps/worker-oidc/test/rate-limit.test.ts`

**Interfaces:**
- Produces: `rateLimit` — a Drizzle table export from `worker/db/schema.ts`, columns `id: text`, `key: text` (unique), `count: integer`, `lastRequest: integer`. Consumed by Task 3's `worker/rate-limit.ts`.
- Produces: `callAsApp(request: Request, envOverrides?: Partial<typeof env>): Promise<Response>` in `test/helpers/call-app.ts` keeps its existing signature — behavior only changes (auto-assigns a synthetic `cf-connecting-ip` header when the caller's request doesn't already set one). Every later test task relies on this to isolate its own IP-based test scenarios from every other test file.

- [ ] **Step 1: Write the failing tests for Better Auth's now-enabled default rules**

Create `apps/worker-oidc/test/rate-limit.test.ts`:

```ts
import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { describe, it } from 'vitest'
import { createDb } from '../worker/db/client.js'
import { rateLimit } from '../worker/db/schema.js'
import { callAsApp } from './helpers/call-app.js'
import { seedUser } from './helpers/sign-in.js'

const FIXED_IP = '203.0.113.10'
const OTHER_IP = '203.0.113.20'

function signIn(ip: string, email: string, password: string) {
    return callAsApp(
        new Request('https://example.com/api/auth/sign-in/email', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
            body: JSON.stringify({ email, password })
        })
    )
}

function requestPasswordReset(ip: string, email: string) {
    return callAsApp(
        new Request('https://example.com/api/auth/request-password-reset', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
            body: JSON.stringify({ email, redirectTo: '/reset-password' })
        })
    )
}

describe('rate limiting', () => {
    describe('/api/auth/* built-in defaults', () => {
        it('blocks the 4th sign-in attempt from the same IP within the 10s window', async ({ expect }) => {
            await seedUser('rl-sign-in@example.com', 'correct-horse-battery')

            const first = await signIn(FIXED_IP, 'rl-sign-in@example.com', 'wrong-password')
            const second = await signIn(FIXED_IP, 'rl-sign-in@example.com', 'wrong-password')
            const third = await signIn(FIXED_IP, 'rl-sign-in@example.com', 'wrong-password')
            const fourth = await signIn(FIXED_IP, 'rl-sign-in@example.com', 'wrong-password')

            expect(first.status).not.toBe(429)
            expect(second.status).not.toBe(429)
            expect(third.status).not.toBe(429)
            expect(fourth.status).toBe(429)
        })

        it('blocks the 4th request-password-reset attempt from the same IP within the 60s window', async ({ expect }) => {
            const first = await requestPasswordReset(FIXED_IP, 'rl-reset-1@example.com')
            const second = await requestPasswordReset(FIXED_IP, 'rl-reset-1@example.com')
            const third = await requestPasswordReset(FIXED_IP, 'rl-reset-1@example.com')
            const fourth = await requestPasswordReset(FIXED_IP, 'rl-reset-1@example.com')

            expect(first.status).not.toBe(429)
            expect(second.status).not.toBe(429)
            expect(third.status).not.toBe(429)
            expect(fourth.status).toBe(429)
        })

        it('allows requests again once the window has elapsed', async ({ expect }) => {
            await requestPasswordReset(FIXED_IP, 'rl-reset-2@example.com')
            await requestPasswordReset(FIXED_IP, 'rl-reset-2@example.com')
            await requestPasswordReset(FIXED_IP, 'rl-reset-2@example.com')
            const blocked = await requestPasswordReset(FIXED_IP, 'rl-reset-2@example.com')
            expect(blocked.status).toBe(429)

            // Simulate the 60s window elapsing by back-dating this key's row directly, same
            // technique test/password-reset.test.ts already uses for verification.expiresAt.
            const db = createDb(env.OIDC_DB)
            await db.update(rateLimit).set({ lastRequest: Date.now() - 61_000 }).where(eq(rateLimit.key, `${FIXED_IP}|/request-password-reset`))

            const afterWindow = await requestPasswordReset(FIXED_IP, 'rl-reset-2@example.com')
            expect(afterWindow.status).not.toBe(429)
        })

        it('scopes the limit per path, not just per IP', async ({ expect }) => {
            await seedUser('rl-scope@example.com', 'correct-horse-battery')
            const scopeIp = '203.0.113.30'

            await signIn(scopeIp, 'rl-scope@example.com', 'wrong-password')
            await signIn(scopeIp, 'rl-scope@example.com', 'wrong-password')
            const blockedSignIn = await signIn(scopeIp, 'rl-scope@example.com', 'wrong-password')
            expect(blockedSignIn.status).toBe(429)

            const stillAllowedReset = await requestPasswordReset(scopeIp, 'rl-scope@example.com')
            expect(stillAllowedReset.status).not.toBe(429)
        })
    })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:run -w @capstone/openid-connect -- rate-limit`
Expected: all four new tests FAIL (no request ever returns `429` yet, since rate limiting isn't enabled).

- [ ] **Step 3: Add the `rateLimit` table to the schema**

Edit `apps/worker-oidc/worker/db/schema.ts`. Insert this block directly after the `invite` table export (after its closing `)` , before `export const userRelations`):

```ts
// Backs both worker/auth.ts's rateLimit: { storage: 'database' } config (everything under
// /api/auth/*) and worker/rate-limit.ts's hand-rolled middleware for /api/invites/accept, which
// sits outside Better Auth's own handler. Shape confirmed by actually running
// `npx auth@1.7.1 generate` with rateLimit.storage: 'database' set — hand-added here rather than
// via a full regen, since a full regen currently wipes every other hand-added field in this file
// (the user role/banned/banReason/banExpires columns, the whole invite table) and reformats
// everything, which the existing "expected to produce no diff" comment above the invite table
// doesn't yet reflect. `lastRequest` is a plain epoch-ms number, not `timestamp_ms` mode — Better
// Auth's own rate-limiter code treats it as a raw number, not a Date.
export const rateLimit = sqliteTable('rate_limit', {
    id: text('id').primaryKey(),
    key: text('key').notNull().unique(),
    count: integer('count').notNull(),
    lastRequest: integer('last_request').notNull()
})
```

- [ ] **Step 4: Generate the migration**

Run: `cd apps/worker-oidc && npx drizzle-kit generate`
Expected: a new file under `apps/worker-oidc/drizzle/`, containing only a `CREATE TABLE rate_limit (...)` statement (review it — it should not touch any other table).

- [ ] **Step 5: Apply the migration locally**

Run: `npm run migrations:auth -w @capstone/openid-connect`
Expected: succeeds, applying the new migration to the local D1 instance.

- [ ] **Step 6: Enable the config in `worker/auth.ts`**

Edit `apps/worker-oidc/worker/auth.ts`. Add `rateLimit` and `advanced` to the `betterAuth({...})` call — insert directly after the `disabledPaths: ['/sign-up/email'],` line:

```ts
        disabledPaths: ['/sign-up/email'],
        // Better Auth's own default (enabled: isProduction) never actually turns on in this
        // deployment — Cloudflare Workers doesn't set NODE_ENV, so isProduction is always false
        // here (confirmed by reading @better-auth/core's env-impl.mjs directly). Enable it
        // explicitly instead. storage: 'database' reuses OIDC_DB via the same Drizzle adapter
        // already used everywhere else in this worker — no new binding. See
        // worker/db/schema.ts's `rateLimit` table and worker/rate-limit.ts (the one endpoint,
        // /api/invites/accept, outside this handler that also needs rate limiting).
        rateLimit: {
            enabled: true,
            storage: 'database',
            customRules: {
                // Better Auth's own default special rules cover /sign-in*, /sign-up*,
                // /change-password, /change-email (3/10s) and /request-password-reset,
                // /forget-password* (3/60s) — but not this endpoint, the actual token-redemption
                // step, which would otherwise fall back to the loose 100/10s global default.
                '/reset-password': { window: 60, max: 5 }
            }
        },
        // CF-Connecting-IP is the Workers-canonical trusted client IP, set by Cloudflare's edge
        // and unspoofable by the client. Better Auth's own default header is x-forwarded-for.
        advanced: {
            ipAddress: {
                ipAddressHeaders: ['cf-connecting-ip']
            }
        },
```

- [ ] **Step 7: Fix the test helper so existing tests don't collide on a shared IP bucket**

Edit `apps/worker-oidc/test/helpers/call-app.ts`:

```ts
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import app from '../../worker/index.js'

// Rate limiting keys on IP + path. None of this suite's ~10 test files set a client-IP header on
// their synthetic requests, so without this, every one of them would resolve to Better Auth's own
// shared "no-trusted-ip" fallback bucket and trip each other's limits. Assigning each call its own
// random IP (unless the caller already set one) keeps every existing test file working unchanged;
// only test/rate-limit.test.ts deliberately sets a fixed, shared IP across several calls to force
// and verify a collision.
function randomSyntheticIp() {
    return Array.from({ length: 4 }, () => Math.floor(Math.random() * 256)).join('.')
}

export async function callAsApp(request: Request, envOverrides: Partial<typeof env> = {}) {
    const headers = new Headers(request.headers)
    if (!headers.has('cf-connecting-ip')) headers.set('cf-connecting-ip', randomSyntheticIp())
    const withIp = new Request(request, { headers })

    const ctx = createExecutionContext()
    const response = await app.fetch(withIp, { ...env, ...envOverrides }, ctx)
    await waitOnExecutionContext(ctx)
    return response
}
```

- [ ] **Step 8: Run the new tests to verify they pass**

Run: `npm run test:run -w @capstone/openid-connect -- rate-limit`
Expected: all four tests PASS.

- [ ] **Step 9: Run the full suite to confirm nothing else broke**

Run: `npm run test:run -w @capstone/openid-connect`
Expected: every test file passes, including all pre-existing ones (unaffected by the synthetic-IP change, since none of them set the header explicitly).

- [ ] **Step 10: Commit**

```bash
git add apps/worker-oidc/worker/auth.ts apps/worker-oidc/worker/db/schema.ts apps/worker-oidc/drizzle apps/worker-oidc/test/helpers/call-app.ts apps/worker-oidc/test/rate-limit.test.ts
git commit -m "feat(openid-connect): enable database-backed rate limiting for /api/auth/*"
```

---

### Task 2: Custom rate limit for `/reset-password` token redemption

**Files:**
- Modify: `apps/worker-oidc/test/rate-limit.test.ts` (config already added in Task 1, Step 6 — this task only adds the test proving it)

**Interfaces:**
- Consumes: `callAsApp` from Task 1 (synthetic-IP behavior), `customRules['/reset-password']` config from Task 1, Step 6.

- [ ] **Step 1: Write the failing test**

Add inside the existing `describe('rate limiting', ...)` block in `apps/worker-oidc/test/rate-limit.test.ts`, as a sibling to the `describe('/api/auth/* built-in defaults', ...)` block:

```ts
    describe('/api/auth/reset-password custom rule', () => {
        it('blocks the 6th reset-password attempt from the same IP within the 60s window', async ({ expect }) => {
            const ip = '203.0.113.40'
            const attempt = () =>
                callAsApp(
                    new Request('https://example.com/api/auth/reset-password', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
                        body: JSON.stringify({ newPassword: 'irrelevant-not-used-1234', token: 'not-a-real-token' })
                    })
                )

            for (let i = 0; i < 5; i++) {
                const response = await attempt()
                expect(response.status).not.toBe(429)
            }
            const sixth = await attempt()
            expect(sixth.status).toBe(429)
        })
    })
```

Note: this test doesn't need this task's config to already be wrong to be "red" — at this point (after Task 1) the config is already live, so run it now expecting it to already PASS, since Task 1, Step 6 already added the `customRules` entry. This step exists to prove the specific max-5 rule is correctly wired, not the generic infrastructure (that's Task 1's job).

- [ ] **Step 2: Run the test to verify it passes**

Run: `npm run test:run -w @capstone/openid-connect -- rate-limit`
Expected: PASS. If it fails, re-check the `customRules` key in `worker/auth.ts` is the bare `'/reset-password'`, not `'/api/auth/reset-password'` — Better Auth strips the `/api/auth` base path before matching (confirmed in the spec via `normalizePathname`).

- [ ] **Step 3: Run the full suite**

Run: `npm run test:run -w @capstone/openid-connect`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/worker-oidc/test/rate-limit.test.ts
git commit -m "test(openid-connect): cover the /reset-password custom rate-limit rule"
```

---

### Task 3: Hand-rolled rate limiting for `POST /api/invites/accept`

**Files:**
- Create: `apps/worker-oidc/worker/rate-limit.ts`
- Modify: `apps/worker-oidc/worker/index.ts`
- Modify: `apps/worker-oidc/test/rate-limit.test.ts`

**Interfaces:**
- Consumes: `rateLimit` table from Task 1 (`worker/db/schema.ts`), `Db` type from `worker/db/client.ts:8`, `createDb` from `worker/db/client.ts:4`.
- Produces: `consumeRateLimit(db: Db, key: string, windowSeconds: number, max: number): Promise<boolean>` and `registerInviteAcceptRateLimit(app: Hono<{ Bindings: Env }>): void`, both exported from `worker/rate-limit.ts`. Nothing later in this plan consumes these, but they follow the same `registerXxx(app)` naming convention as every other route/middleware registrar in `worker/index.ts` (`registerAcceptInviteRoute`, `registerAdminUsersRoutes`, etc.) for consistency.

- [ ] **Step 1: Write the failing tests**

Add to `apps/worker-oidc/test/rate-limit.test.ts`, as a new top-level `describe` sibling to the two added in Tasks 1–2:

```ts
describe('POST /api/invites/accept rate limiting', () => {
    function acceptInvite(headers: Record<string, string>, body: unknown) {
        return callAsApp(
            new Request('https://example.com/api/invites/accept', {
                method: 'POST',
                headers: { 'content-type': 'application/json', ...headers },
                body: JSON.stringify(body)
            })
        )
    }

    it('blocks the 6th attempt from the same IP within the 60s window', async ({ expect }) => {
        const ip = '203.0.113.50'
        for (let i = 0; i < 5; i++) {
            const response = await acceptInvite({ 'cf-connecting-ip': ip }, { token: 'not-a-real-token', password: 'irrelevant1234' })
            expect(response.status).not.toBe(429)
        }
        const sixth = await acceptInvite({ 'cf-connecting-ip': ip }, { token: 'not-a-real-token', password: 'irrelevant1234' })
        expect(sixth.status).toBe(429)
    })

    it('does not rate-limit a different IP', async ({ expect }) => {
        const busyIp = '203.0.113.60'
        const otherIp = '203.0.113.61'
        for (let i = 0; i < 5; i++) {
            await acceptInvite({ 'cf-connecting-ip': busyIp }, { token: 'not-a-real-token', password: 'irrelevant1234' })
        }
        const blocked = await acceptInvite({ 'cf-connecting-ip': busyIp }, { token: 'not-a-real-token', password: 'irrelevant1234' })
        expect(blocked.status).toBe(429)

        const stillAllowed = await acceptInvite({ 'cf-connecting-ip': otherIp }, { token: 'not-a-real-token', password: 'irrelevant1234' })
        expect(stillAllowed.status).not.toBe(429)
    })

    it('still rate-limits a request with no resolvable client IP', async ({ expect }) => {
        // Deliberately don't set cf-connecting-ip, and route around callAsApp's auto-injection by
        // setting it to an empty string, which Better Auth's own getIPFromHeader-equivalent
        // parsing (and this middleware's own header read) treats as absent.
        for (let i = 0; i < 5; i++) {
            const response = await acceptInvite({ 'cf-connecting-ip': '' }, { token: 'not-a-real-token', password: 'irrelevant1234' })
            expect(response.status).not.toBe(429)
        }
        const sixth = await acceptInvite({ 'cf-connecting-ip': '' }, { token: 'not-a-real-token', password: 'irrelevant1234' })
        expect(sixth.status).toBe(429)
    })

    it('rate-limits before the route handler parses the body, even for a malformed body', async ({ expect }) => {
        const ip = '203.0.113.70'
        for (let i = 0; i < 5; i++) {
            const response = await callAsApp(
                new Request('https://example.com/api/invites/accept', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
                    body: 'not valid json at all'
                })
            )
            expect(response.status).not.toBe(429)
        }
        const sixth = await callAsApp(
            new Request('https://example.com/api/invites/accept', {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
                body: 'not valid json at all'
            })
        )
        expect(sixth.status).toBe(429)
    })
})

describe('consumeRateLimit concurrency', () => {
    it('allows exactly max concurrent requests to succeed, never more', async ({ expect }) => {
        const { createDb } = await import('../worker/db/client.js')
        const { consumeRateLimit } = await import('../worker/rate-limit.js')
        const db = createDb(env.OIDC_DB)
        const key = `concurrency-test|${crypto.randomUUID()}`

        const results = await Promise.all(Array.from({ length: 8 }, () => consumeRateLimit(db, key, 10, 3)))

        expect(results.filter(Boolean).length).toBe(3)
    })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:run -w @capstone/openid-connect -- rate-limit`
Expected: FAIL. The `describe('POST /api/invites/accept rate limiting', ...)` tests fail because nothing 429s yet; the `consumeRateLimit concurrency` test fails because `../worker/rate-limit.js` doesn't exist yet (module not found).

- [ ] **Step 3: Implement `worker/rate-limit.ts`**

Create `apps/worker-oidc/worker/rate-limit.ts`:

```ts
import { generateRandomString } from 'better-auth/crypto'
import { and, eq, gt, lt, sql } from 'drizzle-orm'
import type { Hono } from 'hono'
import { createDb, type Db } from './db/client.js'
import { rateLimit } from './db/schema.js'

// Mirrors better-auth's own database-backed rate limiter (node_modules/better-auth/dist/api/
// rate-limiter/index.mjs's createDatabaseStorageWrapper) against the same `rate_limit` table
// worker/auth.ts's rateLimit: { storage: 'database' } config already creates — trimmed to the one
// path this worker needs (no plugin hooks, no configurable backends). Needed only for
// POST /api/invites/accept, which sits outside Better Auth's own /api/auth/* handler and so never
// sees its built-in limiter.
export async function consumeRateLimit(db: Db, key: string, windowSeconds: number, max: number): Promise<boolean> {
    const now = Date.now()
    const windowStart = now - windowSeconds * 1000

    const [existing] = await db.select().from(rateLimit).where(eq(rateLimit.key, key)).limit(1)

    if (!existing) {
        try {
            await db.insert(rateLimit).values({ id: generateRandomString(32, 'a-z', 'A-Z', '0-9'), key, count: 1, lastRequest: now })
            return true
        } catch {
            // Lost a race against a concurrent first request for the same key — it exists now, so
            // fall through and evaluate against its row instead of erroring this request.
            return consumeRateLimit(db, key, windowSeconds, max)
        }
    }

    if (existing.lastRequest < windowStart) {
        const result = await db
            .update(rateLimit)
            .set({ count: 1, lastRequest: now })
            .where(and(eq(rateLimit.key, key), lt(rateLimit.lastRequest, windowStart)))
        return result.meta.changes > 0
    }

    const result = await db
        .update(rateLimit)
        .set({ count: sql`${rateLimit.count} + 1`, lastRequest: now })
        .where(and(eq(rateLimit.key, key), gt(rateLimit.lastRequest, windowStart), lt(rateLimit.count, max)))
    return result.meta.changes > 0
}

// Same `${ip}|${path}` key format Better Auth's own limiter uses internally
// (createRateLimitKey in @better-auth/core/utils/ip) — not read back by it, just kept visually
// consistent since both mechanisms write into the same table. Falls back to the same
// "no-trusted-ip" bucket Better Auth's own getIP falls back to when the header is absent or empty,
// so a request with no resolvable client IP is still rate-limited rather than passing through
// unlimited.
export function registerInviteAcceptRateLimit(app: Hono<{ Bindings: Env }>) {
    app.use('/api/invites/accept', async (c, next) => {
        const ip = c.req.header('cf-connecting-ip') || 'no-trusted-ip'
        const db = createDb(c.env.OIDC_DB)
        const allowed = await consumeRateLimit(db, `${ip}|/api/invites/accept`, 60, 5)
        if (!allowed) {
            return c.json({ message: 'Too many requests. Please try again later.' }, 429, { 'X-Retry-After': '60' })
        }
        return next()
    })
}
```

- [ ] **Step 4: Wire the middleware into `worker/index.ts`**

Edit `apps/worker-oidc/worker/index.ts`:

```ts
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { registerAcceptInviteRoute } from './accept-invite.js'
import { registerAdminUsersRoutes } from './admin-users.js'
import { createAuth } from './auth.js'
import { registerBootstrapAdminUserRoute } from './bootstrap-admin-user.js'
import { createDb } from './db/client.js'
import { registerInviteAcceptRateLimit } from './rate-limit.js'
import { registerBootstrapRoute } from './register-oauth-client.js'
import { registerWorkerAdminAuthorizeGate } from './restrict-worker-admin-client.js'

const app = new Hono<{ Bindings: Env }>()

registerBootstrapRoute(app)
registerBootstrapAdminUserRoute(app)
registerAdminUsersRoutes(app)
// Must run before registerAcceptInviteRoute's own handler below so an over-limit request never
// reaches it — same ordering discipline as registerWorkerAdminAuthorizeGate below.
registerInviteAcceptRateLimit(app)
registerAcceptInviteRoute(app)
// Must run before the catch-all /api/auth/* handler below so it can intercept and redirect
// instead of letting Better Auth's own authorize handler run.
registerWorkerAdminAuthorizeGate(app)
```

(Only the import block and the two new/reordered lines change; everything below `registerWorkerAdminAuthorizeGate(app)` in the existing file is untouched.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:run -w @capstone/openid-connect -- rate-limit`
Expected: PASS.

- [ ] **Step 6: Run the full suite**

Run: `npm run test:run -w @capstone/openid-connect`
Expected: all tests pass.

- [ ] **Step 7: Run lint and build**

Run: `npm run lint -w @capstone/openid-connect && npm run build -w @capstone/openid-connect`
Expected: both clean.

- [ ] **Step 8: Commit**

```bash
git add apps/worker-oidc/worker/rate-limit.ts apps/worker-oidc/worker/index.ts apps/worker-oidc/test/rate-limit.test.ts
git commit -m "feat(openid-connect): rate-limit POST /api/invites/accept"
```

---

### Task 4: Documentation and changeset

**Files:**
- Modify: `apps/worker-oidc/CLAUDE.md`
- Create: `.changeset/rate-limiting.md`

**Interfaces:**
- Consumes: nothing new — this task only describes what Tasks 1–3 already built. No production code changes.

- [ ] **Step 1: Add the `worker/rate-limit.ts` bullet**

In `apps/worker-oidc/CLAUDE.md`'s `worker/` file list (the bullet list starting with `worker/index.ts`), add a new bullet after the `worker/send-password-reset-email.ts` line:

```markdown
- `worker/rate-limit.ts` — `consumeRateLimit(db, key, windowSeconds, max)`, a trimmed reimplementation of Better Auth's own database-backed rate-limiter logic against the same `rate_limit` table `worker/auth.ts`'s `rateLimit: { storage: 'database' }` config creates, and `registerInviteAcceptRateLimit(app)`, which applies it to `POST /api/invites/accept` — the one anonymous, token-guessable endpoint that sits outside Better Auth's own `/api/auth/*` handler and so never sees its built-in limiter. See "Rate limiting" below.
```

- [ ] **Step 2: Extend the `worker/auth.ts` bullet**

In the same file list, find the existing `worker/auth.ts` bullet and add one sentence to its end (after the existing content, before the bullet ends):

```markdown
 Also enables `rateLimit: { storage: 'database' }` (reusing `OIDC_DB` via the same Drizzle adapter, since Better Auth's own default — `enabled: isProduction` — never actually turns on in this deployment, as Cloudflare Workers doesn't set `NODE_ENV`) and `advanced.ipAddress.ipAddressHeaders: ['cf-connecting-ip']` — see "Rate limiting" below.
```

- [ ] **Step 3: Add the test-file list bullet**

In the same file's `test:`/`test:run` bullet (the long one listing every file under `test/`), add after the `password-reset.test.ts` description:

```markdown
, `rate-limit.test.ts` (Better Auth's now-enabled built-in limiter on `/sign-in`/`/request-password-reset`, the custom `/reset-password` rule, the hand-rolled `/api/invites/accept` middleware, per-path/per-IP key scoping, the no-resolvable-IP fallback bucket, and a direct concurrency test proving `consumeRateLimit`'s atomicity)
```

Also add one sentence to that same bullet's existing description of `test/helpers/call-app.ts`:

```markdown
 `callAsApp` also assigns each call a random synthetic `cf-connecting-ip` header unless the caller's request already sets one, so this suite's requests don't collide on rate-limit buckets with each other — see `rate-limit.test.ts`.
```

- [ ] **Step 4: Add the "## Rate limiting" section**

Add a new section after the existing "## Password reset" section in `apps/worker-oidc/CLAUDE.md`:

```markdown
## Rate limiting

`worker/auth.ts`'s `rateLimit: { storage: 'database' }` protects everything under `/api/auth/*` — Better Auth's own default (`enabled: isProduction`) never actually turns on in this deployment, since Cloudflare Workers doesn't set `NODE_ENV`, so it's enabled explicitly instead. Storage is `'database'`, reusing the existing `OIDC_DB` D1 binding via the same Drizzle adapter every other piece of state in this worker already uses — no new Cloudflare binding. `advanced.ipAddress.ipAddressHeaders: ['cf-connecting-ip']` overrides Better Auth's default `x-forwarded-for`, since `CF-Connecting-IP` is the Workers-canonical, unspoofable client IP.

Policy:

| Endpoint | Mechanism | Window | Max |
|---|---|---|---|
| `/sign-in/*` (email + social) | Better Auth built-in default | 10s | 3 |
| `/request-password-reset`, `/forget-password*` | Better Auth built-in default | 60s | 3 |
| `/reset-password` (token redemption) | `customRules` in `worker/auth.ts` | 60s | 5 |
| `POST /api/invites/accept` (token redemption) | `worker/rate-limit.ts`, hand-rolled | 60s | 5 |
| everything else under `/api/auth/*` | Better Auth built-in global default | 10s | 100 |

`POST /api/invites/accept` needs its own mechanism because it's a plain Hono route (`worker/accept-invite.ts`), not part of Better Auth's `/api/auth/*` catch-all — `worker/rate-limit.ts`'s `consumeRateLimit` reimplements Better Auth's own atomic conditional-`UPDATE` approach (not a plain read-then-write) against the same `rateLimit` table its `storage: 'database'` config creates.

`/internal/*` and `/api/admin/*` are deliberately not rate-limited: the former is already gated by a 32+ character `BETTER_AUTH_SECRET` bearer token (not a brute-forceable surface), and the latter already requires a valid, role-checked session (a request-volume concern, not the credential/token-guessing threat this covers).
```

- [ ] **Step 5: Write the changeset**

Create `.changeset/rate-limiting.md`:

```markdown
---
'@capstone/openid-connect': minor
---

Enable real, atomic, D1-backed rate limiting on the credential/token-guessing surface (sign-in, password-reset request and redemption, invite-token redemption). Better Auth's built-in limiter had never actually been on in this deployment: it only defaults to enabled when `NODE_ENV === 'production'`, which Cloudflare Workers never sets. Storage is `'database'`, reusing the existing `OIDC_DB` D1 binding rather than adding a new Cloudflare binding.
```

- [ ] **Step 6: Verify formatting**

Run: `npx biome check --write apps/worker-oidc/CLAUDE.md` (CLAUDE.md itself isn't Biome-formatted, this is a no-op safety check) and re-read the two edited sections to confirm they render correctly as Markdown.

- [ ] **Step 7: Commit**

```bash
git add apps/worker-oidc/CLAUDE.md .changeset/rate-limiting.md
git commit -m "docs(openid-connect): document rate limiting"
```

---

## Final Verification

- [ ] `npm run lint -w @capstone/openid-connect`
- [ ] `npm run build -w @capstone/openid-connect`
- [ ] `npm run test:run -w @capstone/openid-connect` — full suite green, including every pre-existing test file and all new `rate-limit.test.ts` cases.
- [ ] Manual dev-server check: `npm run dev -w @capstone/openid-connect`, attempt sign-in with a wrong password 4 times in a row from the same browser, confirm the 4th response is a `429`.
