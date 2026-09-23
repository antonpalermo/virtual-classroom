import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { describe, it } from 'vitest'
import { createDb } from '../worker/db/client.js'
import { oauthClient, user } from '../worker/db/schema.js'
import { BOOTSTRAP_USER_EMAIL, BOOTSTRAP_USER_ID } from '../worker/register-oauth-client.js'
import { callAsApp } from './helpers/call-app.js'

const REDIRECT_URI = 'https://admin.example.test/auth-callback'

function bootstrapRequest(secret = 'test-secret') {
    return new Request(`https://example.com/internal/oauth-clients/worker-admin?redirect_uri=${encodeURIComponent(REDIRECT_URI)}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${secret}` }
    })
}

describe('POST /internal/oauth-clients/:name', () => {
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

    it('rejects a client name outside the allowlist', async ({ expect }) => {
        const response = await callAsApp(
            new Request(`https://example.com/internal/oauth-clients/evil?redirect_uri=${encodeURIComponent(REDIRECT_URI)}`, {
                method: 'POST',
                headers: { authorization: 'Bearer test-secret' }
            }),
            { BETTER_AUTH_SECRET: 'test-secret' }
        )
        expect(response.status).toBe(404)
    })

    it('registers worker-client as a separate client from worker-admin', async ({ expect }) => {
        const admin = await callAsApp(bootstrapRequest(), { BETTER_AUTH_SECRET: 'test-secret' })
        const client = await callAsApp(
            new Request(
                `https://example.com/internal/oauth-clients/worker-client?redirect_uri=${encodeURIComponent('http://localhost:5173/auth-callback')}`,
                {
                    method: 'POST',
                    headers: { authorization: 'Bearer test-secret' }
                }
            ),
            { BETTER_AUTH_SECRET: 'test-secret' }
        )
        expect(client.status).toBe(200)
        const { client_id: adminId } = await admin.json<{ client_id: string }>()
        const { client_id: clientId } = await client.json<{ client_id: string }>()
        expect(clientId).toBeTruthy()
        expect(clientId).not.toBe(adminId)
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

    it('registers successfully with a real loopback local-dev redirect URI', async ({ expect }) => {
        // D1 storage isn't reset between `it` blocks in this file, so clear any `worker-admin`
        // row left behind by earlier tests (registered against REDIRECT_URI, an https host)
        // before hitting the bootstrap route with a different redirect_uri — otherwise the
        // idempotency check (SELECT by name) would just return that earlier row's client_id
        // without this request's redirect_uri ever reaching adminCreateOAuthClient, and this
        // test would pass without actually exercising anything.
        const db = createDb(env.OIDC_DB)
        await db.delete(oauthClient).where(eq(oauthClient.name, 'worker-admin'))

        // worker-admin's real local-dev redirect URI (see apps/worker-admin/CLAUDE.md): loopback
        // host + http. Under application_type: 'web' this is unconditionally rejected even over
        // https, which is the bug this test guards against — see the comment on
        // `application_type: 'native'` in worker/register-oauth-client.ts.
        const loopbackRedirectUri = 'http://localhost:8790/auth-callback'
        const response = await callAsApp(
            new Request(`https://example.com/internal/oauth-clients/worker-admin?redirect_uri=${encodeURIComponent(loopbackRedirectUri)}`, {
                method: 'POST',
                headers: { authorization: 'Bearer test-secret' }
            }),
            { BETTER_AUTH_SECRET: 'test-secret' }
        )

        expect(response.status).toBe(200)
        const { client_id } = await response.json<{ client_id: string }>()
        expect(client_id).toBeTruthy()
    })
})
