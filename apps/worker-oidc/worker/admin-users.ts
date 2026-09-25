import { createLocalAccountIssuer } from '@better-auth/core/db'
import { verifyAccessTokenWithJwks } from '@capstone/auth-verify'
import { generateRandomString } from 'better-auth/crypto'
import { and, eq, ne } from 'drizzle-orm'
import type { Context, Hono } from 'hono'
import { cors } from 'hono/cors'
import type { JSONWebKeySet } from 'jose'
import { createAuth } from './auth.js'
import { createDb, type Db } from './db/client.js'
import { invite, user } from './db/schema.js'

const ROLES = ['user', 'admin'] as const
type Role = (typeof ROLES)[number]
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

// Same cause-chain walk as register-oauth-client.ts's isDuplicateNameError, for the same reason:
// drizzle-orm wraps the underlying D1 error, and the actual SQLite message
// ("UNIQUE constraint failed: user.email") is nested under `.cause` (D1's own Error) rather than
// on the top-level error's own `.message`. Used as a race-condition fallback behind each route's
// own pre-check (select-then-act is inherently racy under concurrent callers) — never assume
// which depth it lands at.
function isDuplicateEmailError(error: unknown): boolean {
    let current: unknown = error
    for (let depth = 0; current instanceof Error && depth < 5; depth++) {
        if (current.message.includes('UNIQUE constraint failed') && current.message.includes('user.email')) {
            return true
        }
        current = current.cause
    }
    return false
}

async function requireAdmin(c: Context<{ Bindings: Env }>) {
    const authorization = c.req.header('authorization')
    const token = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined
    if (!token) return { error: 401 as const }

    const db = createDb(c.env.OIDC_DB)
    const auth = createAuth(db, c.env)
    // Verified in-process against this worker's own signing keys, not over a real HTTP self-fetch
    // — it already holds them (it's the one that issued the token), so a network round trip back
    // to its own /api/auth/jwks would be pure overhead (and, in the Miniflare test sandbox, isn't
    // guaranteed to land on the same D1 instance this request is using at all).
    const jwksResponse = await auth.handler(new Request(`${c.env.BETTER_AUTH_URL}/api/auth/jwks`))
    const jwks = await jwksResponse.json<JSONWebKeySet>()
    const claims = await verifyAccessTokenWithJwks(token, jwks)
    if (!claims) return { error: 401 as const }

    // Re-check role fresh against D1 rather than trusting the token's own (possibly stale) role
    // claim, so a demotion or ban takes effect immediately rather than waiting for token expiry.
    const [row] = await db.select().from(user).where(eq(user.id, claims.sub)).limit(1)
    if (row?.role !== 'admin' || row.banned) return { error: 403 as const }

    return { db, caller: row }
}

export function registerAdminUsersRoutes(app: Hono<{ Bindings: Env }>) {
    app.use('/api/admin/*', cors())

    app.get('/api/admin/users', async c => {
        const gate = await requireAdmin(c)
        if ('error' in gate) return c.text('', gate.error)

        const rows = await gate.db
            .select({
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                banned: user.banned,
                banReason: user.banReason,
                banExpires: user.banExpires,
                createdAt: user.createdAt
            })
            .from(user)
        return c.json({ users: rows })
    })

    app.post('/api/admin/users', async c => {
        const gate = await requireAdmin(c)
        if ('error' in gate) return c.text('', gate.error)

        const body = await c.req.json<{ name?: string; email?: string }>().catch(() => null)
        if (typeof body?.name !== 'string' || !body.name || typeof body.email !== 'string' || !body.email) {
            return c.text('Missing name or email', 400)
        }

        const [existing] = await gate.db.select().from(user).where(eq(user.email, body.email)).limit(1)
        if (existing) return c.text('A user with that email already exists', 409)

        const auth = createAuth(gate.db, c.env)
        const authContext = await auth.$context
        let createdUser: Awaited<ReturnType<typeof authContext.internalAdapter.createUser>>
        try {
            // No credential account is created here — the invitee sets their own password by
            // redeeming the invite link (see worker/accept-invite.ts), so the account is
            // intentionally not sign-in-able until then.
            createdUser = await authContext.internalAdapter.createUser(
                { name: body.name, email: body.email, role: 'user' },
                { method: 'admin' }
            )
        } catch (error) {
            // The select above already covers the common case; this catches the case where a
            // second concurrent POST for the same email won the insert between that select and
            // here (the loser gets a clean 409 instead of an uncaught 500).
            if (!isDuplicateEmailError(error)) throw error
            return c.text('A user with that email already exists', 409)
        }

        const token = generateRandomString(32, 'a-z', 'A-Z', '0-9')
        await gate.db.insert(invite).values({ token, userId: createdUser.id, expiresAt: new Date(Date.now() + INVITE_TTL_MS) })

        return c.json({
            user: { id: createdUser.id, name: createdUser.name, email: createdUser.email, role: createdUser.role },
            inviteUrl: `${c.env.BETTER_AUTH_URL}/accept-invite?token=${token}`
        })
    })

    app.patch('/api/admin/users/:id', async c => {
        const gate = await requireAdmin(c)
        if ('error' in gate) return c.text('', gate.error)

        const id = c.req.param('id')
        const body = await c.req.json<{ name?: string; email?: string; role?: string }>().catch(() => null)
        if (!body) return c.text('Invalid body', 400)
        if (body.role !== undefined && !ROLES.includes(body.role as Role)) return c.text('Invalid role', 400)
        if (body.role !== undefined && body.role !== 'admin' && id === gate.caller.id) {
            return c.text('An admin cannot change their own role', 400)
        }

        const update: Partial<{ name: string; email: string; role: string }> = {}
        if (body.name !== undefined) update.name = body.name
        if (body.email !== undefined) update.email = body.email
        if (body.role !== undefined) update.role = body.role
        if (Object.keys(update).length === 0) return c.text('No fields to update', 400)

        if (body.email !== undefined) {
            const [conflict] = await gate.db
                .select()
                .from(user)
                .where(and(eq(user.email, body.email), ne(user.id, id)))
                .limit(1)
            if (conflict) return c.text('A user with that email already exists', 409)
        }

        try {
            await gate.db.update(user).set(update).where(eq(user.id, id))
        } catch (error) {
            // Same race-condition fallback as POST above — the pre-check just ran but a
            // concurrent write for the same email could still have landed in between.
            if (!isDuplicateEmailError(error)) throw error
            return c.text('A user with that email already exists', 409)
        }
        return c.json({ ok: true })
    })

    app.post('/api/admin/users/:id/ban', async c => {
        const gate = await requireAdmin(c)
        if ('error' in gate) return c.text('', gate.error)

        const id = c.req.param('id')
        if (id === gate.caller.id) return c.text('An admin cannot ban themselves', 400)

        const body = await c.req
            .json<{ reason?: string; expiresAt?: string }>()
            .catch(() => ({}) as { reason?: string; expiresAt?: string })
        await gate.db
            .update(user)
            .set({ banned: true, banReason: body?.reason ?? null, banExpires: body?.expiresAt ? new Date(body.expiresAt) : null })
            .where(eq(user.id, id))
        return c.json({ ok: true })
    })

    app.post('/api/admin/users/:id/unban', async c => {
        const gate = await requireAdmin(c)
        if ('error' in gate) return c.text('', gate.error)

        const id = c.req.param('id')
        await gate.db.update(user).set({ banned: false, banReason: null, banExpires: null }).where(eq(user.id, id))
        return c.json({ ok: true })
    })

    app.delete('/api/admin/users/:id', async c => {
        const gate = await requireAdmin(c)
        if ('error' in gate) return c.text('', gate.error)

        const id = c.req.param('id')
        if (id === gate.caller.id) return c.text('An admin cannot delete themselves', 400)

        const auth = createAuth(gate.db, c.env)
        const authContext = await auth.$context
        // Deletes the user's own session/account rows explicitly; everything else that
        // references user.id (oauth_client, oauth_refresh_token, oauth_access_token,
        // oauth_consent, invite) cleans up via each table's own `onDelete: 'cascade'` FK.
        await authContext.internalAdapter.deleteUser(id)
        return c.json({ ok: true })
    })
}

// Exported so worker/accept-invite.ts can share the same "hash + link/update the credential
// account" mechanic without duplicating it — used at account creation time there is impossible
// (no password exists yet), so this is invoked once, at invite-redemption time.
export async function setUserPassword(db: Db, env: Env, userId: string, newPassword: string) {
    const auth = createAuth(db, env)
    const authContext = await auth.$context
    const hashedPassword = await authContext.password.hash(newPassword)
    const existingAccount = await authContext.internalAdapter.findCredentialAccount(userId)
    if (existingAccount) {
        await authContext.internalAdapter.updatePassword(userId, hashedPassword)
    } else {
        await authContext.internalAdapter.createAccount({
            userId,
            providerId: 'credential',
            issuer: createLocalAccountIssuer('credential'),
            accountId: userId,
            password: hashedPassword
        })
    }
}
