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

app.all('/api/auth/*', async c => {
    const db = createDb(c.env.AUTH_DB)
    const auth = createAuth(db, c.env)
    const response = await auth.handler(c.req.raw)

    if (new URL(c.req.url).pathname === '/api/auth/callback/google') {
        const sessionToken = response.headers.get('set-auth-token')
        const location = response.headers.get('location')
        if (sessionToken && location) {
            const redirectUrl = new URL(location, c.req.url)
            redirectUrl.searchParams.set('session', sessionToken)
            const headers = new Headers(response.headers)
            headers.set('location', redirectUrl.toString())
            return new Response(response.body, { status: response.status, headers })
        }
    }

    return response
})

export default app
