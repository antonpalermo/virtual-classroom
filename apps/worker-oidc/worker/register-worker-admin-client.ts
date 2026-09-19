import { eq } from 'drizzle-orm'
import type { Hono } from 'hono'
import { createAuth } from './auth.js'
import { createDb, type Db } from './db/client.js'
import { oauthClient, user } from './db/schema.js'

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
// Exported so tests can pre-seed/inspect this fixed row directly, e.g. to hold it constant while
// exercising the separate oauth_client.name race below.
export const BOOTSTRAP_USER_ID = 'worker-oidc-bootstrap'
export const BOOTSTRAP_USER_EMAIL = 'worker-oidc-bootstrap@internal.invalid'

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

// The idempotency check below (SELECT by name, then INSERT if absent) is a check-then-act race:
// two concurrent calls can both pass the "not found" check and both attempt to insert a
// `worker-admin` row. `oauthClient.name` carries a real unique index (`oauthClient_name_uidx`,
// see db/schema.ts) so only one INSERT wins; the loser's `adminCreateOAuthClient` call surfaces
// that failure as a `DrizzleQueryError` (drizzle-orm wraps the underlying D1 error) whose own
// top-level `.message` is just `Failed query: insert into "oauth_client" ...` — the actual SQLite
// message (`UNIQUE constraint failed: oauth_client.name`) is nested two levels down the `.cause`
// chain (`error.cause` is D1's own `Error` wrapping `D1_ERROR: UNIQUE constraint failed: ...`,
// and `error.cause.cause` is the raw SQLite message underneath that) — confirmed empirically
// against this exact stack (better-auth's drizzle adapter, `registrationSource: "managed"` skips
// its own unique-constraint conversion, so nothing upstream normalizes this). We walk the cause
// chain looking for that specific message rather than assuming which depth it lands at, so we
// don't misidentify (and swallow) an unrelated error.
function isDuplicateNameError(error: unknown): boolean {
    let current: unknown = error
    for (let depth = 0; current instanceof Error && depth < 5; depth++) {
        if (current.message.includes('UNIQUE constraint failed') && current.message.includes('oauth_client.name')) {
            return true
        }
        current = current.cause
    }
    return false
}

// Registers worker-admin as a public OAuth client. Called once per environment via a manual
// curl (see apps/worker-admin/CLAUDE.md), never at runtime by a client itself — that's why this
// goes through the plugin's SERVER_ONLY adminCreateOAuthClient API rather than dynamic client
// registration. Idempotent: re-running it returns the existing client_id instead of creating a
// duplicate row, so it's safe to call again if you're not sure whether it already ran — including
// when two calls race each other concurrently (see isDuplicateNameError above).
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

        try {
            const client = await auth.api.adminCreateOAuthClient({
                headers: new Headers(),
                body: {
                    client_name: 'worker-admin',
                    redirect_uris: [redirectUri],
                    token_endpoint_auth_method: 'none',
                    // 'native', not 'web': worker-admin's real local-dev redirect URI is
                    // http://localhost:8790/auth-callback (loopback + http). In
                    // validateClientRedirectUri (node_modules/@better-auth/oauth-provider/dist/
                    // authorize-Crqw4_bR.mjs:1698-1701), 'web' unconditionally rejects loopback
                    // hosts even over https, so this would 500 on any real local-dev registration.
                    // 'native' (lines 1702-1710) allows http on loopback and https on non-loopback,
                    // covering both our local-dev and production redirect URI shapes. Per the
                    // plugin's OAuthClient type docs, application_type only governs redirect-URI
                    // validation policy — it has no effect on client auth, PKCE, or
                    // token_endpoint_auth_method, so worker-admin remains a public PKCE client.
                    application_type: 'native',
                    skip_consent: false,
                    grant_types: ['authorization_code'],
                    response_types: ['code'],
                    scope: 'openid email profile'
                }
            })
            return c.json({ client_id: client.client_id })
        } catch (error) {
            if (!isDuplicateNameError(error)) {
                throw error
            }

            // Lost the race: another concurrent call's INSERT won. Re-read the row it created
            // and return its client_id instead — same success shape as the non-racing path.
            const [winner] = await db.select().from(oauthClient).where(eq(oauthClient.name, 'worker-admin')).limit(1)
            if (!winner) {
                throw error
            }
            return c.json({ client_id: winner.clientId })
        }
    })
}
