import { getIP } from '@better-auth/core/utils/ip'
import { generateRandomString } from 'better-auth/crypto'
import { and, eq, gt, lt, lte, sql } from 'drizzle-orm'
import type { Hono } from 'hono'
import { createDb, type Db } from './db/client.js'
import { rateLimit } from './db/schema.js'

// Mirrors better-auth's own database-backed rate limiter (node_modules/better-auth/dist/api/
// rate-limiter/index.mjs's createDatabaseStorageWrapper) against the same `rate_limit` table
// worker/auth.ts's rateLimit: { storage: 'database' } config already creates — trimmed to the one
// path this worker needs (no plugin hooks, no configurable backends). Needed only for
// POST /api/invites/accept, which sits outside Better Auth's own /api/auth/* handler and so never
// sees its built-in limiter.
export async function consumeRateLimit(db: Db, key: string, windowSeconds: number, max: number, retried = false): Promise<boolean> {
    const now = Date.now()
    const windowInMs = windowSeconds * 1000

    const [existing] = await db.select().from(rateLimit).where(eq(rateLimit.key, key)).limit(1)

    if (!existing) {
        try {
            await db.insert(rateLimit).values({ id: generateRandomString(32, 'a-z', 'A-Z', '0-9'), key, count: 1, lastRequest: now })
            return true
        } catch (error) {
            // The common case is losing a race against a concurrent first request for the same
            // key — confirm the row actually exists now before treating this as that race (mirrors
            // Better Auth's own consume(): a genuine write error, e.g. a D1 outage, leaves no row
            // behind and should rethrow immediately rather than waste a retry). Bounded to one
            // retry either way: it must not recurse forever and exhaust the Worker's CPU/wall-clock
            // limit.
            if (retried) throw error
            const [afterRace] = await db.select().from(rateLimit).where(eq(rateLimit.key, key)).limit(1)
            if (!afterRace) throw error
            return consumeRateLimit(db, key, windowSeconds, max, true)
        }
    }

    // Same `>=` as Better Auth's decideConsume/consume, so a request landing exactly on the window
    // boundary resets rather than falling through to the increment branch's strict `gt` and being
    // spuriously denied.
    if (now - existing.lastRequest >= windowInMs) {
        // Compare-and-swap against the exact lastRequest this request read (Better Auth's own
        // `lte(lastRequest, data.lastRequest)`): of several concurrent resetters only one wins.
        const result = await db
            .update(rateLimit)
            .set({ count: 1, lastRequest: now })
            .where(and(eq(rateLimit.key, key), lte(rateLimit.lastRequest, existing.lastRequest)))
        if (result.meta.changes > 0) return true
        // Lost the race: re-evaluate against the winner's freshly-reset row via the normal
        // increment path rather than denying outright. Same one-retry bound as above; a second
        // lost race denies (over-denial, never over-admission).
        if (retried) return false
        return consumeRateLimit(db, key, windowSeconds, max, true)
    }

    const result = await db
        .update(rateLimit)
        .set({ count: sql`${rateLimit.count} + 1`, lastRequest: now })
        .where(and(eq(rateLimit.key, key), gt(rateLimit.lastRequest, now - windowInMs), lt(rateLimit.count, max)))
    return result.meta.changes > 0
}

// Same `${ip}|${path}` key format Better Auth's own limiter uses internally
// (createRateLimitKey in @better-auth/core/utils/ip) — not read back by it, just kept visually
// consistent since both mechanisms write into the same table. The IP is resolved with Better
// Auth's own getIP (same ipAddressHeaders as worker/auth.ts), so it's normalized identically —
// notably IPv6 collapsed to its /64, so a client can't mint a fresh bucket per request by rotating
// the low bits it controls. Falls back to the same "no-trusted-ip" bucket Better Auth uses when no
// IP resolves, so such a request is still rate-limited rather than passing through unlimited.
const IP_OPTIONS = { advanced: { ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] } } }

// Window must stay <= Better Auth's longest configured window (currently 60s): its database
// storage prunes every rate_limit row older than that, including these, mid-window. Shared between
// the consumeRateLimit call and the 429's X-Retry-After so the two can't drift apart.
const WINDOW_SECONDS = 60
const MAX_ATTEMPTS = 5

export function registerInviteAcceptRateLimit(app: Hono<{ Bindings: Env }>) {
    app.use('/api/invites/accept', async (c, next) => {
        // registerAcceptInviteRoute below only registers POST for this path — app.use() matches
        // every HTTP method, so without this check a GET/PUT/DELETE (which would just 404 past
        // this point) still consumed a slot in the same IP+path bucket, letting a caller burn
        // through a victim's 5-request budget with cheap non-POST requests and lock out their real
        // POST attempt for the rest of the window.
        if (c.req.method !== 'POST') return next()
        const ip = getIP(c.req.raw, IP_OPTIONS) ?? 'no-trusted-ip'
        const db = createDb(c.env.OIDC_DB)
        const allowed = await consumeRateLimit(db, `${ip}|/api/invites/accept`, WINDOW_SECONDS, MAX_ATTEMPTS)
        if (!allowed) {
            return c.json({ message: 'Too many requests. Please try again later.' }, 429, { 'X-Retry-After': String(WINDOW_SECONDS) })
        }
        return next()
    })
}
