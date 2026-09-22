import { APIError } from 'better-auth/api'
import type { Hono } from 'hono'
import { createAuth } from './auth.js'
import { createDb } from './db/client.js'

// One-time (idempotent) manual call to seed the first admin account, since sign-up is disabled
// for worker-admin (see the before hook in worker/auth.ts). Gated by BETTER_AUTH_SECRET, same
// convention as register-worker-admin-client.ts. Calls signUpEmail directly (not the HTTP
// /sign-up/email route) so it isn't affected by that hook — it never sends a client_id, and the
// hook only blocks requests whose client_id matches the registered worker-admin client.
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
        if (!body?.email || !body.password) {
            return c.text('Missing email or password', 400)
        }

        const db = createDb(c.env.OIDC_DB)
        const auth = createAuth(db, c.env)

        try {
            const { user } = await auth.api.signUpEmail({
                body: { email: body.email, password: body.password, name: body.name ?? 'Admin' }
            })
            return c.json({ userId: user.id, email: user.email })
        } catch (error) {
            // USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL — treat re-running this against an
            // already-seeded environment as a no-op success, same idempotency shape as
            // register-worker-admin-client.ts.
            if (error instanceof APIError && error.status === 'UNPROCESSABLE_ENTITY') {
                return c.json({ message: 'Admin user already exists' })
            }
            throw error
        }
    })
}
