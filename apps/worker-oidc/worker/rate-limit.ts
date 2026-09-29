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
