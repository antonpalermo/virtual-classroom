import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { describe, it } from 'vitest'
import { createDb } from '../src/db/client'
import { oauthClient, user } from '../src/db/schema'
import { BOOTSTRAP_USER_EMAIL, BOOTSTRAP_USER_ID } from '../src/register-worker-admin-client'
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

    it('closes the idempotency race — two concurrent calls with no existing row both resolve to the same client_id', async ({ expect }) => {
        // D1 storage in this test file isn't reset between `it` blocks (state accumulates across
        // the whole file), so explicitly force the exact precondition this test is about,
        // regardless of what earlier tests left behind:
        //  - no existing `worker-admin` oauth_client row (the race we're closing starts here)
        //  - the bootstrap user already present, so its own separate check-then-insert (a
        //    different, pre-existing race on `user.email` in `ensureBootstrapUser`, out of scope
        //    for this fix) can't also fire and mask which race we're actually exercising.
        const db = createDb(env.OIDC_DB)
        await db.delete(oauthClient).where(eq(oauthClient.name, 'worker-admin'))
        const [existingBootstrapUser] = await db.select().from(user).where(eq(user.id, BOOTSTRAP_USER_ID)).limit(1)
        if (!existingBootstrapUser) {
            await db.insert(user).values({
                id: BOOTSTRAP_USER_ID,
                name: 'worker-oidc bootstrap',
                email: BOOTSTRAP_USER_EMAIL,
                emailVerified: true
            })
        }

        const [first, second] = await Promise.all([
            callAsApp(bootstrapRequest(), { BETTER_AUTH_SECRET: 'test-secret' }),
            callAsApp(bootstrapRequest(), { BETTER_AUTH_SECRET: 'test-secret' })
        ])

        expect(first.status).toBe(200)
        expect(second.status).toBe(200)

        const { client_id: firstId } = await first.json<{ client_id: string }>()
        const { client_id: secondId } = await second.json<{ client_id: string }>()

        expect(firstId).toBeTruthy()
        expect(secondId).toBe(firstId)
    })
})
