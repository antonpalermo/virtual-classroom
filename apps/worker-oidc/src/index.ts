import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { createAuth } from './auth'
import { createDb } from './db/client'
import { registerOidcPages } from './pages'
import { registerBootstrapRoute } from './register-worker-admin-client'

const app = new Hono<{ Bindings: Env }>()

app.get('/', c => c.text('ok'))

registerBootstrapRoute(app)
registerOidcPages(app)

// These three are called directly, cross-origin, from worker-admin's browser JS (no service
// binding involved) — a public JWKS, a userinfo lookup gated by the caller's own access token,
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
