import { env } from 'cloudflare:workers'
import { eq, like } from 'drizzle-orm'
import { afterEach, beforeEach, describe, it, vi } from 'vitest'
import { createDb } from '../worker/db/client.js'
import { verification } from '../worker/db/schema.js'
import { sendPasswordResetEmail } from '../worker/send-email.js'
import { callAsApp } from './helpers/call-app.js'
import { seedUser } from './helpers/sign-in.js'

const RESET_EMAIL_FROM = 'reset@test.example.com'
const EMAIL_PROVIDER_ENDPOINT = 'https://email-provider.test.example.com'
const EMAIL_PROVIDER_SECRET_KEY = 'test-secret-key'
const emailEnv = { RESET_EMAIL_FROM, EMAIL_PROVIDER_ENDPOINT, EMAIL_PROVIDER_SECRET_KEY }

// Stubs the outbound email provider call.
// Nothing else in these flows calls fetch, so every recorded call is a send attempt.
function mockEmailProvider(status = 200) {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ success: status < 300 }, { status }))
}

function requestReset(email: string) {
    return callAsApp(
        new Request('https://example.com/api/auth/request-password-reset', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email, redirectTo: '/reset-password' })
        }),
        emailEnv
    )
}

function resetPassword(token: string, newPassword: string) {
    return callAsApp(
        new Request('https://example.com/api/auth/reset-password', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ newPassword, token })
        })
    )
}

// D1 storage isn't isolated per test within this file (rows from earlier tests are still
// present), and `identifier` doesn't carry the requesting email — so instead of matching on
// email, take the most recently created reset-password row, which is always the one the calling
// test just requested (each test requests at most one reset).
async function latestResetToken() {
    const db = createDb(env.OIDC_DB)
    const rows = await db.select().from(verification).where(like(verification.identifier, 'reset-password:%'))
    if (rows.length === 0) throw new Error('expected a reset-password verification row')
    const [latest] = rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    return latest.identifier.slice('reset-password:'.length)
}

describe('password reset', () => {
    // Every reset request triggers a send; without a stub it would hit the network.
    beforeEach(() => {
        mockEmailProvider()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('returns the same generic response whether or not the email exists, and only emails a real account', async ({ expect }) => {
        await seedUser('reset-generic@example.com', 'correct-horse-battery')
        const fetchSpy = mockEmailProvider()

        const existing = await requestReset('reset-generic@example.com')
        expect(fetchSpy).toHaveBeenCalledTimes(1)
        const missing = await requestReset('no-such-user@example.com')
        expect(fetchSpy).toHaveBeenCalledTimes(1)

        expect(existing.status).toBe(missing.status)
        expect(await existing.clone().json()).toEqual(await missing.clone().json())
    })

    it('emails the requesting user a working reset link through the email provider', async ({ expect }) => {
        await seedUser('reset-email@example.com', 'correct-horse-battery')
        const fetchSpy = mockEmailProvider()

        const response = await requestReset('reset-email@example.com')

        expect(response.status).toBe(200)
        expect(fetchSpy).toHaveBeenCalledTimes(1)
        const [[input, init]] = fetchSpy.mock.calls
        expect(String(input)).toBe(`${EMAIL_PROVIDER_ENDPOINT}/v1/send`)
        expect(init?.method).toBe('POST')
        // Headers lookups are case-insensitive, so a misspelled header name reads as null here.
        const headers = new Headers(init?.headers)
        expect(headers.get('authorization')).toBe(`Bearer ${EMAIL_PROVIDER_SECRET_KEY}`)
        expect(headers.get('content-type')).toBe('application/json')

        const body = JSON.parse(String(init?.body))
        expect(body.to).toBe('reset-email@example.com')
        // The provider requires `from`; it accepts a string or { name, email }.
        expect(body.from?.email ?? body.from).toBe(RESET_EMAIL_FROM)
        expect(body.subject).toEqual(expect.any(String))
        expect(body.body).toContain(`/api/auth/reset-password/${await latestResetToken()}`)
    })

    it('rejects when the email provider refuses the send, so the failure gets logged instead of passing silently', async ({ expect }) => {
        mockEmailProvider(401)

        await expect(
            sendPasswordResetEmail({ ...env, ...emailEnv }, 'reset-fail@example.com', 'https://example.com/reset')
        ).rejects.toThrow()
    })

    it('still returns the generic response when the email send fails', async ({ expect }) => {
        await seedUser('reset-send-fails@example.com', 'correct-horse-battery')
        mockEmailProvider(500)

        const response = await requestReset('reset-send-fails@example.com')

        expect(response.status).toBe(200)
    })

    it('resets the password, revokes existing sessions, and the token is single-use', async ({ expect }) => {
        await seedUser('reset-happy@example.com', 'old-password-1')
        const signInResponse = await callAsApp(
            new Request('https://example.com/api/auth/sign-in/email', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ email: 'reset-happy@example.com', password: 'old-password-1' })
            })
        )
        const sessionCookie = signInResponse.headers
            .getSetCookie()
            .find(entry => entry.includes('session_token'))
            ?.split(';')[0]
        if (!sessionCookie) throw new Error('expected a session cookie from sign-in')

        const requestResponse = await requestReset('reset-happy@example.com')
        expect(requestResponse.status).toBe(200)
        const token = await latestResetToken()

        const resetResponse = await resetPassword(token, 'new-password-2')
        expect(resetResponse.status).toBe(200)

        const oldPasswordSignIn = await callAsApp(
            new Request('https://example.com/api/auth/sign-in/email', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ email: 'reset-happy@example.com', password: 'old-password-1' })
            })
        )
        expect(oldPasswordSignIn.status).toBeGreaterThanOrEqual(400)

        const newPasswordSignIn = await callAsApp(
            new Request('https://example.com/api/auth/sign-in/email', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ email: 'reset-happy@example.com', password: 'new-password-2' })
            })
        )
        expect(newPasswordSignIn.status).toBeLessThan(300)

        const staleSessionResponse = await callAsApp(
            new Request('https://example.com/api/auth/get-session', { headers: { cookie: sessionCookie } })
        )
        const staleSessionBody = await staleSessionResponse.json()
        expect(staleSessionBody).toBeNull()
    })

    it('rejects an unknown token', async ({ expect }) => {
        const response = await resetPassword('not-a-real-token', 'new-password-2')
        expect(response.status).toBeGreaterThanOrEqual(400)
        expect(response.status).toBeLessThan(500)
    })

    it('rejects a token that was already used', async ({ expect }) => {
        await seedUser('reset-reuse@example.com', 'old-password-1')
        await requestReset('reset-reuse@example.com')
        const token = await latestResetToken()

        const first = await resetPassword(token, 'new-password-2')
        expect(first.status).toBe(200)

        const second = await resetPassword(token, 'another-password-3')
        expect(second.status).toBeGreaterThanOrEqual(400)
        expect(second.status).toBeLessThan(500)
    })

    it('rejects an expired token', async ({ expect }) => {
        await seedUser('reset-expired@example.com', 'old-password-1')
        await requestReset('reset-expired@example.com')
        const token = await latestResetToken()

        const db = createDb(env.OIDC_DB)
        await db
            .update(verification)
            .set({ expiresAt: new Date(Date.now() - 60_000) })
            .where(eq(verification.identifier, `reset-password:${token}`))

        const response = await resetPassword(token, 'new-password-2')
        expect(response.status).toBeGreaterThanOrEqual(400)
        expect(response.status).toBeLessThan(500)
    })

    it('lets a banned user complete a reset, but the existing ban still blocks sign-in afterward', async ({ expect }) => {
        await seedUser('reset-banned@example.com', 'old-password-1', { banned: true })
        const requestResponse = await requestReset('reset-banned@example.com')
        expect(requestResponse.status).toBe(200)
        const token = await latestResetToken()

        const resetResponse = await resetPassword(token, 'new-password-2')
        expect(resetResponse.status).toBe(200)

        const signInResponse = await callAsApp(
            new Request('https://example.com/api/auth/sign-in/email', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ email: 'reset-banned@example.com', password: 'new-password-2' })
            })
        )
        expect(signInResponse.status).toBeGreaterThanOrEqual(400)
    })
})
