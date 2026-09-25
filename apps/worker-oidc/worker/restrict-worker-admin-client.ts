import { eq } from 'drizzle-orm'
import type { Hono } from 'hono'
import { createAuth } from './auth.js'
import { createDb } from './db/client.js'
import { oauthClient } from './db/schema.js'

// Blocks a signed-in non-admin from completing worker-admin's OAuth flow. `/api/auth/oauth2/
// authorize` is the one endpoint every sign-in path (email/password, and Google — whose own
// callback also lands back here, see src/GoogleButton.tsx) resumes through before a client ever
// receives an authorization code, so gating it here covers both. Both registered clients are
// configured `skip_consent: false` (see worker/register-oauth-client.ts), so a rejection here
// can't be routed around via consent or token exchange — no code is ever issued to reach them.
export function registerWorkerAdminAuthorizeGate(app: Hono<{ Bindings: Env }>) {
    app.use('/api/auth/oauth2/authorize', async (c, next) => {
        const clientId = new URL(c.req.url).searchParams.get('client_id')
        if (!clientId) return next()

        const db = createDb(c.env.OIDC_DB)
        const [client] = await db.select().from(oauthClient).where(eq(oauthClient.clientId, clientId)).limit(1)
        // Scoped to the worker-admin client only — worker-client's own authorize flow (and any
        // future client) is untouched.
        if (client?.name !== 'worker-admin') return next()

        const auth = createAuth(db, c.env)
        const result = await auth.api.getSession({ headers: c.req.raw.headers })
        // No session yet — nothing to gate. Better Auth's own authorize handler redirects to
        // /login as normal; the visitor lands back here (and gets checked again) once signed in.
        if (!result) return next()

        const role = (result.user as { role?: string }).role
        if (role === 'admin') return next()

        return c.redirect('/login?error=not_authorized')
    })
}
