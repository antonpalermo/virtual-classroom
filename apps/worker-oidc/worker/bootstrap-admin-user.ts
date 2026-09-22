import { APIError } from 'better-auth/api'
import { eq } from 'drizzle-orm'
import type { Hono } from 'hono'
import { createAuth } from './auth.js'
import { createDb } from './db/client.js'
import { user as userTable } from './db/schema.js'

// One-time (idempotent) manual call to seed an admin account, since /sign-up/email is disabled
// entirely (see disabledPaths in worker/auth.ts). Gated by BETTER_AUTH_SECRET, same convention
// as register-worker-admin-client.ts. Calls signUpEmail directly (not the HTTP /sign-up/email
// route) so it isn't affected by disabledPaths, which only gates the HTTP router.
//
// curl -X POST http://localhost:8791/internal/users/bootstrap-admin \
//     -H "Authorization: Bearer <BETTER_AUTH_SECRET>" \
//     -H "Content-Type: application/json" \
//     -d '{"email":"admin@example.com","password":"<password>","name":"Admin"}'
export function registerBootstrapAdminUserRoute(app: Hono<{ Bindings: Env }>) {
    app.post('/internal/users/bootstrap-admin', async c => {
        if (c.req.header('authorization') !== `Bearer ${c.env.BETTER_AUTH_SECRET}`) {
            return c.text('Unauthorized', 401)
        }

        const body = await c.req.json<{ email?: string; password?: string; name?: string }>().catch(() => null)
        if (typeof body?.email !== 'string' || !body.email || typeof body.password !== 'string' || !body.password) {
            return c.text('Missing email or password', 400)
        }

        const db = createDb(c.env.OIDC_DB)
        const auth = createAuth(db, c.env)

        try {
            const { user } = await auth.api.signUpEmail({
                body: { email: body.email, password: body.password, name: body.name ?? 'Admin' }
            })
            // signUpEmail always creates emailVerified: false (better-auth hardcodes this,
            // unconditionally, in the create-user path). This route is the only way accounts get
            // created now — nothing else in this worker ever verifies an email — so an unverified
            // bootstrap user could never link a Google sign-in later (better-auth's account
            // linking defaults to requireLocalEmailVerified: true). Bootstrap is already gated by
            // BETTER_AUTH_SECRET, i.e. already trusted, so mark it verified directly.
            await db.update(userTable).set({ emailVerified: true }).where(eq(userTable.id, user.id))
            return c.json({ created: true, userId: user.id, email: user.email })
        } catch (error) {
            // USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL — treat re-running this against an
            // already-seeded environment as a no-op success, same idempotency shape as
            // register-worker-admin-client.ts. Checked via error.body.code (not just
            // error.status === 'UNPROCESSABLE_ENTITY'): better-auth's sign-up handler also
            // throws that same status for FAILED_TO_CREATE_USER (e.g. a genuine DB failure —
            // see node_modules/better-auth/dist/api/routes/sign-up.mjs), which the broader
            // status-only check would have silently swallowed as a fake success.
            if (error instanceof APIError && error.body?.code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL') {
                // Existing account left untouched, including its password — re-running this
                // with a different intended password does NOT change it.
                return c.json({ created: false, message: 'Admin user already exists' })
            }
            throw error
        }
    })
}
