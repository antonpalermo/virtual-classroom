import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { registerAcceptInviteRoute } from './accept-invite.js'
import { registerAdminUsersRoutes } from './admin-users.js'
import { createAuth } from './auth.js'
import { registerBootstrapAdminUserRoute } from './bootstrap-admin-user.js'
import { createDb } from './db/client.js'
import { registerBootstrapRoute } from './register-oauth-client.js'
import { registerWorkerAdminAuthorizeGate } from './restrict-worker-admin-client.js'

const app = new Hono<{ Bindings: Env }>()

registerBootstrapRoute(app)
registerBootstrapAdminUserRoute(app)
registerAdminUsersRoutes(app)
registerAcceptInviteRoute(app)
// Must run before the catch-all /api/auth/* handler below so it can intercept and redirect
// instead of letting Better Auth's own authorize handler run.
registerWorkerAdminAuthorizeGate(app)

// These three are called directly, cross-origin, from worker-admin's and worker-client's browser
// JS (no service binding involved) — a public JWKS, a userinfo lookup gated by the caller's own access token,
// and a token exchange gated by the caller's own authorization code + PKCE verifier. None of
// them are guarded by a cookie, so opening CORS wide doesn't leak anything the caller didn't
// already have. Same reasoning worker-auth already applied to its own /api/auth/jwks.
app.use('/api/auth/jwks', cors())
app.use('/api/auth/oauth2/userinfo', cors())
app.use('/api/auth/oauth2/token', cors())

app.all('/api/auth/*', c => {
    const db = createDb(c.env.OIDC_DB)
    const auth = createAuth(db, c.env)
    return auth.handler(c.req.raw)
})

export default app
