import { eq } from 'drizzle-orm'
import type { Hono } from 'hono'
import { createAuth } from './auth'
import { createDb, type Db } from './db/client'
import { oauthClient, user } from './db/schema'

// adminCreateOAuthClient is SERVER_ONLY (not reachable over the plugin's HTTP router), but its
// handler still unconditionally requires a session — `createOAuthClientEndpoint` in
// @better-auth/oauth-provider calls `getSessionFromCtx` and throws UNAUTHORIZED if it's empty,
// even on the `{ admin: true }` path, regardless of `clientPrivileges` config. There's no real
// signed-in user in this bootstrap flow, so we synthesize a throwaway session directly on the
// shared AuthContext (`await auth.$context`) that `auth.api.*` calls share for a single
// `createAuth(...)` instance — `getSessionFromCtx` special-cases `ctx.context.session` and
// returns it without touching cookies/DB session lookup at all. The session still needs a real
// `userId` because `oauthClient.userId` has a DB foreign key to `user.id`, so we upsert a fixed
// "bootstrap" user row to satisfy it. This never creates a session row or cookie, and the
// fabricated AuthContext is discarded at the end of the request — it isn't a real login.
const BOOTSTRAP_USER_ID = 'worker-oidc-bootstrap'
const BOOTSTRAP_USER_EMAIL = 'worker-oidc-bootstrap@internal.invalid'

async function ensureBootstrapUser(db: Db) {
    const [existing] = await db.select().from(user).where(eq(user.id, BOOTSTRAP_USER_ID)).limit(1)
    if (existing) {
        return existing
    }

    const [created] = await db
        .insert(user)
        .values({
            id: BOOTSTRAP_USER_ID,
            name: 'worker-oidc bootstrap',
            email: BOOTSTRAP_USER_EMAIL,
            emailVerified: true
        })
        .returning()
    return created
}

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

        const bootstrapUser = await ensureBootstrapUser(db)
        const auth = createAuth(db, c.env)
        const authContext = await auth.$context
        const now = new Date()
        authContext.session = {
            session: {
                id: 'worker-oidc-bootstrap-session',
                token: 'worker-oidc-bootstrap-session',
                userId: bootstrapUser.id,
                createdAt: now,
                updatedAt: now,
                expiresAt: new Date(now.getTime() + 60_000)
            },
            user: bootstrapUser
        }

        const client = await auth.api.adminCreateOAuthClient({
            headers: new Headers(),
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
