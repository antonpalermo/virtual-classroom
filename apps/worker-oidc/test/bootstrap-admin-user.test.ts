import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { describe, it } from 'vitest'
import { createDb } from '../worker/db/client.js'
import { user } from '../worker/db/schema.js'
import { callAsApp } from './helpers/call-app.js'

function bootstrapRequest(body: unknown, secret = 'test-secret') {
    return new Request('https://example.com/internal/users/bootstrap-admin', {
        method: 'POST',
        headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
        body: JSON.stringify(body)
    })
}

describe('POST /internal/users/bootstrap-admin', () => {
    it('rejects a request with the wrong bearer secret', async ({ expect }) => {
        const response = await callAsApp(
            bootstrapRequest({ email: 'admin@example.com', password: 'correct-horse-battery' }, 'wrong-secret'),
            {
                BETTER_AUTH_SECRET: 'test-secret'
            }
        )
        expect(response.status).toBe(401)
    })

    it('rejects a request missing email or password', async ({ expect }) => {
        const response = await callAsApp(bootstrapRequest({ email: 'admin@example.com' }), { BETTER_AUTH_SECRET: 'test-secret' })
        expect(response.status).toBe(400)
    })

    it('creates the admin user and can sign in with the given credentials afterwards', async ({ expect }) => {
        const response = await callAsApp(
            bootstrapRequest({ email: 'first-admin@example.com', password: 'correct-horse-battery', name: 'First Admin' }),
            { BETTER_AUTH_SECRET: 'test-secret' }
        )
        expect(response.status).toBe(200)
        const { created, email } = await response.json<{ created: boolean; userId: string; email: string }>()
        expect(created).toBe(true)
        expect(email).toBe('first-admin@example.com')

        const signInResponse = await callAsApp(
            new Request('https://example.com/api/auth/sign-in/email', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ email: 'first-admin@example.com', password: 'correct-horse-battery' })
            })
        )
        expect(signInResponse.status).toBeLessThan(300)
    })

    it('marks the created user emailVerified — bootstrap is already secret-gated/trusted', async ({ expect }) => {
        await callAsApp(bootstrapRequest({ email: 'verified-admin@example.com', password: 'correct-horse-battery' }), {
            BETTER_AUTH_SECRET: 'test-secret'
        })

        const db = createDb(env.OIDC_DB)
        const [row] = await db.select().from(user).where(eq(user.email, 'verified-admin@example.com')).limit(1)
        expect(row?.emailVerified).toBe(true)
    })

    it('is idempotent — re-running it against an existing email does not error', async ({ expect }) => {
        const body = { email: 'repeat-admin@example.com', password: 'correct-horse-battery', name: 'Repeat Admin' }
        const first = await callAsApp(bootstrapRequest(body), { BETTER_AUTH_SECRET: 'test-secret' })
        expect(first.status).toBe(200)
        expect((await first.json<{ created: boolean }>()).created).toBe(true)

        const second = await callAsApp(bootstrapRequest(body), { BETTER_AUTH_SECRET: 'test-secret' })
        expect(second.status).toBe(200)
        expect((await second.json<{ created: boolean }>()).created).toBe(false)
    })
})
