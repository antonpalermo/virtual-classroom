import { eq } from 'drizzle-orm'
import type { Hono } from 'hono'
import { setUserPassword } from './admin-users.js'
import { createAuth } from './auth.js'
import { createDb } from './db/client.js'
import { invite, user } from './db/schema.js'

// Anonymous and gated by the invite token itself, not BETTER_AUTH_SECRET — deliberately not under
// /internal/*, whose convention in this codebase is "trusted, secret-gated" (see
// worker/register-oauth-client.ts, worker/bootstrap-admin-user.ts).
export function registerAcceptInviteRoute(app: Hono<{ Bindings: Env }>) {
    app.post('/api/invites/accept', async c => {
        const body = await c.req.json<{ token?: string; password?: string }>().catch(() => null)
        if (typeof body?.token !== 'string' || !body.token || typeof body.password !== 'string' || !body.password) {
            return c.text('Missing token or password', 400)
        }

        const db = createDb(c.env.OIDC_DB)
        const [row] = await db.select().from(invite).where(eq(invite.token, body.token)).limit(1)
        if (!row) return c.text('Invalid invite', 404)
        if (row.usedAt) return c.text('This invite has already been used', 400)
        if (row.expiresAt.getTime() < Date.now()) return c.text('This invite has expired', 400)

        const auth = createAuth(db, c.env)
        const authContext = await auth.$context
        const { minPasswordLength, maxPasswordLength } = authContext.password.config
        if (body.password.length < minPasswordLength || body.password.length > maxPasswordLength) {
            return c.text('Invalid password length', 400)
        }

        await setUserPassword(db, c.env, row.userId, body.password)
        // Proves control of the invite link/email, same rationale as worker/bootstrap-admin-user.ts
        // — unblocks a later Google sign-in linking to this account (requireLocalEmailVerified).
        await db.update(user).set({ emailVerified: true }).where(eq(user.id, row.userId))
        await db.update(invite).set({ usedAt: new Date() }).where(eq(invite.token, body.token))

        return c.json({ ok: true })
    })
}
