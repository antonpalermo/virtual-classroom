import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { describe, it } from 'vitest'
import { createDb } from '../worker/db/client.js'
import { invite, user } from '../worker/db/schema.js'
import { callAsApp } from './helpers/call-app.js'
import { seedUser, signInForTokens } from './helpers/sign-in.js'

async function createInvitedUser(email: string) {
    await seedUser(`invite-admin+${email}`, 'correct-horse-battery', { role: 'admin' })
    const { id_token } = await signInForTokens(`invite-admin+${email}`, 'correct-horse-battery')
    const response = await callAsApp(
        new Request('https://example.com/api/admin/users', {
            method: 'POST',
            headers: { authorization: `Bearer ${id_token}`, 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'Invitee', email })
        })
    )
    const { user: createdUser, inviteUrl } = await response.json<{ user: { id: string }; inviteUrl: string }>()
    const token = new URL(inviteUrl).searchParams.get('token')
    if (!token) throw new Error('expected an invite token')
    return { userId: createdUser.id, token }
}

function acceptRequest(body: unknown) {
    return callAsApp(
        new Request('https://example.com/api/invites/accept', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body)
        })
    )
}

describe('POST /api/invites/accept', () => {
    it('sets a working password, verifies the email, and marks the invite used', async ({ expect }) => {
        const { userId, token } = await createInvitedUser('accept-happy@example.com')

        const response = await acceptRequest({ token, password: 'correct-horse-battery' })
        expect(response.status).toBe(200)

        const signInResponse = await callAsApp(
            new Request('https://example.com/api/auth/sign-in/email', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ email: 'accept-happy@example.com', password: 'correct-horse-battery' })
            })
        )
        expect(signInResponse.status).toBeLessThan(300)

        const db = createDb(env.OIDC_DB)
        const [userRow] = await db.select().from(user).where(eq(user.id, userId)).limit(1)
        expect(userRow?.emailVerified).toBe(true)
        const [inviteRow] = await db.select().from(invite).where(eq(invite.token, token)).limit(1)
        expect(inviteRow?.usedAt).not.toBeNull()
    })

    it('rejects an unknown token', async ({ expect }) => {
        const response = await acceptRequest({ token: 'not-a-real-token', password: 'correct-horse-battery' })
        expect(response.status).toBeGreaterThanOrEqual(400)
        expect(response.status).toBeLessThan(500)
    })

    it('rejects a token that was already used', async ({ expect }) => {
        const { token } = await createInvitedUser('accept-reuse@example.com')
        const first = await acceptRequest({ token, password: 'correct-horse-battery' })
        expect(first.status).toBe(200)

        const second = await acceptRequest({ token, password: 'a-different-password' })
        expect(second.status).toBeGreaterThanOrEqual(400)
        expect(second.status).toBeLessThan(500)
    })

    it('rejects an expired token', async ({ expect }) => {
        const { token } = await createInvitedUser('accept-expired@example.com')
        const db = createDb(env.OIDC_DB)
        await db
            .update(invite)
            .set({ expiresAt: new Date(Date.now() - 60_000) })
            .where(eq(invite.token, token))

        const response = await acceptRequest({ token, password: 'correct-horse-battery' })
        expect(response.status).toBeGreaterThanOrEqual(400)
        expect(response.status).toBeLessThan(500)
    })

    it('rejects a too-short password without consuming the invite', async ({ expect }) => {
        const { token } = await createInvitedUser('accept-short-pw@example.com')
        const response = await acceptRequest({ token, password: 'short' })
        expect(response.status).toBe(400)

        // The invite must still be redeemable — a rejected attempt shouldn't burn it.
        const retry = await acceptRequest({ token, password: 'correct-horse-battery' })
        expect(retry.status).toBe(200)
    })
})
