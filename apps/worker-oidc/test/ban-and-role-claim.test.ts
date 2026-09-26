import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { decodeJwt } from 'jose'
import { describe, it } from 'vitest'
import { createDb } from '../worker/db/client.js'
import { user } from '../worker/db/schema.js'
import { callAsApp } from './helpers/call-app.js'
import { seedUser, signInForTokens } from './helpers/sign-in.js'

function signInRequest(email: string, password: string) {
    return callAsApp(
        new Request('https://example.com/api/auth/sign-in/email', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email, password })
        })
    )
}

describe('id_token role claim', () => {
    it("carries the signed-in user's role", async ({ expect }) => {
        await seedUser('role-admin@example.com', 'correct-horse-battery', { role: 'admin' })
        const { id_token } = await signInForTokens('role-admin@example.com', 'correct-horse-battery')
        expect(decodeJwt(id_token).role).toBe('admin')
    })

    it('defaults to the plain user role', async ({ expect }) => {
        await seedUser('role-user@example.com', 'correct-horse-battery')
        const { id_token } = await signInForTokens('role-user@example.com', 'correct-horse-battery')
        expect(decodeJwt(id_token).role).toBe('user')
    })
})

describe('ban enforcement at sign-in', () => {
    it('rejects sign-in for a currently banned user', async ({ expect }) => {
        await seedUser('banned@example.com', 'correct-horse-battery', { banned: true })
        const response = await signInRequest('banned@example.com', 'correct-horse-battery')
        expect(response.status).toBeGreaterThanOrEqual(400)
    })

    it('allows sign-in and clears the ban once banExpires has passed', async ({ expect }) => {
        const userId = await seedUser('expired-ban@example.com', 'correct-horse-battery', { banned: true })
        const db = createDb(env.OIDC_DB)
        await db
            .update(user)
            .set({ banExpires: new Date(Date.now() - 60_000) })
            .where(eq(user.id, userId))

        const response = await signInRequest('expired-ban@example.com', 'correct-horse-battery')
        expect(response.status).toBeLessThan(300)

        const [row] = await db.select().from(user).where(eq(user.id, userId)).limit(1)
        expect(row?.banned).toBe(false)
    })

    it('still allows sign-in for a never-banned user', async ({ expect }) => {
        await seedUser('never-banned@example.com', 'correct-horse-battery')
        const response = await signInRequest('never-banned@example.com', 'correct-horse-battery')
        expect(response.status).toBeLessThan(300)
    })
})
