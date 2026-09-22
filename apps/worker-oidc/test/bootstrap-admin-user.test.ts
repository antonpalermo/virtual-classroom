import { describe, it } from 'vitest'
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
        const { email } = await response.json<{ userId: string; email: string }>()
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

    it('is idempotent — re-running it against an existing email does not error', async ({ expect }) => {
        const body = { email: 'repeat-admin@example.com', password: 'correct-horse-battery', name: 'Repeat Admin' }
        const first = await callAsApp(bootstrapRequest(body), { BETTER_AUTH_SECRET: 'test-secret' })
        expect(first.status).toBe(200)

        const second = await callAsApp(bootstrapRequest(body), { BETTER_AUTH_SECRET: 'test-secret' })
        expect(second.status).toBe(200)
    })
})
