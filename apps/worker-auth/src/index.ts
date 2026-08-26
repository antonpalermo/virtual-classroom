import { Hono } from 'hono'
import { createAuth } from './auth'
import { createDb } from './db/client'

const app = new Hono<{ Bindings: Env }>()

app.get('/', c => c.text('ok'))

app.all('/api/auth/*', c => {
    const db = createDb(c.env.AUTH_DB)
    const auth = createAuth(db, c.env)
    return auth.handler(c.req.raw)
})

export default app
