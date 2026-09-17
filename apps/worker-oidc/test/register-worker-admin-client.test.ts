import { describe, it } from 'vitest'
import { callAsApp } from './helpers/call-app'

const REDIRECT_URI = 'https://admin.example.test/auth-callback'

function bootstrapRequest(secret = 'test-secret') {
    return new Request(`https://example.com/internal/oauth-clients/worker-admin?redirect_uri=${encodeURIComponent(REDIRECT_URI)}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${secret}` }
    })
}

describe('POST /internal/oauth-clients/worker-admin', () => {
    it('rejects a request with the wrong bearer secret', async ({ expect }) => {
        const response = await callAsApp(bootstrapRequest('wrong-secret'), { BETTER_AUTH_SECRET: 'test-secret' })
        expect(response.status).toBe(401)
    })

    it('rejects a request missing redirect_uri', async ({ expect }) => {
        const response = await callAsApp(
            new Request('https://example.com/internal/oauth-clients/worker-admin', {
                method: 'POST',
                headers: { authorization: 'Bearer test-secret' }
            }),
            { BETTER_AUTH_SECRET: 'test-secret' }
        )
        expect(response.status).toBe(400)
    })

    it('registers a public, PKCE-required, consent-requiring client', async ({ expect }) => {
        const response = await callAsApp(bootstrapRequest(), { BETTER_AUTH_SECRET: 'test-secret' })
        expect(response.status).toBe(200)
        const { client_id } = await response.json<{ client_id: string }>()
        expect(client_id).toBeTruthy()
    })

    it('is idempotent — a second call returns the same client_id', async ({ expect }) => {
        const first = await callAsApp(bootstrapRequest(), { BETTER_AUTH_SECRET: 'test-secret' })
        const { client_id: firstId } = await first.json<{ client_id: string }>()

        const second = await callAsApp(bootstrapRequest(), { BETTER_AUTH_SECRET: 'test-secret' })
        const { client_id: secondId } = await second.json<{ client_id: string }>()

        expect(secondId).toBe(firstId)
    })
})
