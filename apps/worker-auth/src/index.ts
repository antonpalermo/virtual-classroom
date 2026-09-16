import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { createAuth } from './auth'
import { createDb } from './db/client'
import { registerHostedLogin } from './hosted-login'

const app = new Hono<{ Bindings: Env }>()

app.get('/', c => c.text('ok'))

// The JWKS is fetched cross-origin, straight from worker-client's/worker-admin's browser JS (no
// service binding involved there) — it's a set of public keys, safe to open widely.
app.use('/api/auth/jwks', cors())

registerHostedLogin(app)

app.all('/api/auth/*', c => {
    const db = createDb(c.env.AUTH_DB)
    const auth = createAuth(db, c.env)
    return auth.handler(c.req.raw)
})

export default app
