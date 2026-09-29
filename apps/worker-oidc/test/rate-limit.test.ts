import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { describe, it } from 'vitest'
import { createDb } from '../worker/db/client.js'
import { rateLimit } from '../worker/db/schema.js'
import { callAsApp } from './helpers/call-app.js'
import { seedUser } from './helpers/sign-in.js'

const FIXED_IP = '203.0.113.10'

function signIn(ip: string, email: string, password: string) {
    return callAsApp(
        new Request('https://example.com/api/auth/sign-in/email', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
            body: JSON.stringify({ email, password })
        })
    )
}

function requestPasswordReset(ip: string, email: string) {
    return callAsApp(
        new Request('https://example.com/api/auth/request-password-reset', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
            body: JSON.stringify({ email, redirectTo: '/reset-password' })
        })
    )
}

describe('rate limiting', () => {
    describe('/api/auth/* built-in defaults', () => {
        it('blocks the 4th sign-in attempt from the same IP within the 10s window', async ({ expect }) => {
            await seedUser('rl-sign-in@example.com', 'correct-horse-battery')

            const first = await signIn(FIXED_IP, 'rl-sign-in@example.com', 'wrong-password')
            const second = await signIn(FIXED_IP, 'rl-sign-in@example.com', 'wrong-password')
            const third = await signIn(FIXED_IP, 'rl-sign-in@example.com', 'wrong-password')
            const fourth = await signIn(FIXED_IP, 'rl-sign-in@example.com', 'wrong-password')

            expect(first.status).not.toBe(429)
            expect(second.status).not.toBe(429)
            expect(third.status).not.toBe(429)
            expect(fourth.status).toBe(429)
        })

        it('blocks the 4th request-password-reset attempt from the same IP within the 60s window', async ({ expect }) => {
            const first = await requestPasswordReset(FIXED_IP, 'rl-reset-1@example.com')
            const second = await requestPasswordReset(FIXED_IP, 'rl-reset-1@example.com')
            const third = await requestPasswordReset(FIXED_IP, 'rl-reset-1@example.com')
            const fourth = await requestPasswordReset(FIXED_IP, 'rl-reset-1@example.com')

            expect(first.status).not.toBe(429)
            expect(second.status).not.toBe(429)
            expect(third.status).not.toBe(429)
            expect(fourth.status).toBe(429)
        })

        it('allows requests again once the window has elapsed', async ({ expect }) => {
            await requestPasswordReset(FIXED_IP, 'rl-reset-2@example.com')
            await requestPasswordReset(FIXED_IP, 'rl-reset-2@example.com')
            await requestPasswordReset(FIXED_IP, 'rl-reset-2@example.com')
            const blocked = await requestPasswordReset(FIXED_IP, 'rl-reset-2@example.com')
            expect(blocked.status).toBe(429)

            // Simulate the 60s window elapsing by back-dating this key's row directly, same
            // technique test/password-reset.test.ts already uses for verification.expiresAt.
            const db = createDb(env.OIDC_DB)
            await db
                .update(rateLimit)
                .set({ lastRequest: Date.now() - 61_000 })
                .where(eq(rateLimit.key, `${FIXED_IP}|/request-password-reset`))

            const afterWindow = await requestPasswordReset(FIXED_IP, 'rl-reset-2@example.com')
            expect(afterWindow.status).not.toBe(429)
        })

        it('scopes the limit per path, not just per IP', async ({ expect }) => {
            await seedUser('rl-scope@example.com', 'correct-horse-battery')
            const scopeIp = '203.0.113.30'

            await signIn(scopeIp, 'rl-scope@example.com', 'wrong-password')
            await signIn(scopeIp, 'rl-scope@example.com', 'wrong-password')
            await signIn(scopeIp, 'rl-scope@example.com', 'wrong-password')
            const blockedSignIn = await signIn(scopeIp, 'rl-scope@example.com', 'wrong-password')
            expect(blockedSignIn.status).toBe(429)

            const stillAllowedReset = await requestPasswordReset(scopeIp, 'rl-scope@example.com')
            expect(stillAllowedReset.status).not.toBe(429)
        })
    })

    describe('/api/auth/jwks exemption', () => {
        it('never rate-limits the JWKS endpoint (requireAdmin fetches it in-process)', async ({ expect }) => {
            const ip = '203.0.113.90'
            for (let i = 0; i < 101; i++) {
                const response = await callAsApp(new Request('https://example.com/api/auth/jwks', { headers: { 'cf-connecting-ip': ip } }))
                expect(response.status).toBe(200)
            }
        })
    })

    describe('/api/auth/reset-password custom rule', () => {
        it('blocks the 6th reset-password attempt from the same IP within the 60s window', async ({ expect }) => {
            const ip = '203.0.113.40'
            const attempt = () =>
                callAsApp(
                    new Request('https://example.com/api/auth/reset-password', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
                        body: JSON.stringify({ newPassword: 'irrelevant-not-used-1234', token: 'not-a-real-token' })
                    })
                )

            for (let i = 0; i < 5; i++) {
                const response = await attempt()
                expect(response.status).not.toBe(429)
            }
            const sixth = await attempt()
            expect(sixth.status).toBe(429)
        })
    })

    describe('POST /api/invites/accept rate limiting', () => {
        function acceptInvite(headers: Record<string, string>, body: unknown) {
            return callAsApp(
                new Request('https://example.com/api/invites/accept', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json', ...headers },
                    body: JSON.stringify(body)
                })
            )
        }

        it('blocks the 6th attempt from the same IP within the 60s window', async ({ expect }) => {
            const ip = '203.0.113.50'
            for (let i = 0; i < 5; i++) {
                const response = await acceptInvite({ 'cf-connecting-ip': ip }, { token: 'not-a-real-token', password: 'irrelevant1234' })
                expect(response.status).not.toBe(429)
            }
            const sixth = await acceptInvite({ 'cf-connecting-ip': ip }, { token: 'not-a-real-token', password: 'irrelevant1234' })
            expect(sixth.status).toBe(429)
        })

        it('does not rate-limit a different IP', async ({ expect }) => {
            const busyIp = '203.0.113.60'
            const otherIp = '203.0.113.61'
            for (let i = 0; i < 5; i++) {
                await acceptInvite({ 'cf-connecting-ip': busyIp }, { token: 'not-a-real-token', password: 'irrelevant1234' })
            }
            const blocked = await acceptInvite({ 'cf-connecting-ip': busyIp }, { token: 'not-a-real-token', password: 'irrelevant1234' })
            expect(blocked.status).toBe(429)

            const stillAllowed = await acceptInvite(
                { 'cf-connecting-ip': otherIp },
                { token: 'not-a-real-token', password: 'irrelevant1234' }
            )
            expect(stillAllowed.status).not.toBe(429)
        })

        it('still rate-limits a request with no resolvable client IP', async ({ expect }) => {
            // Deliberately don't set cf-connecting-ip, and route around callAsApp's auto-injection by
            // setting it to an empty string, which Better Auth's own getIPFromHeader-equivalent
            // parsing (and this middleware's own header read) treats as absent.
            for (let i = 0; i < 5; i++) {
                const response = await acceptInvite({ 'cf-connecting-ip': '' }, { token: 'not-a-real-token', password: 'irrelevant1234' })
                expect(response.status).not.toBe(429)
            }
            const sixth = await acceptInvite({ 'cf-connecting-ip': '' }, { token: 'not-a-real-token', password: 'irrelevant1234' })
            expect(sixth.status).toBe(429)
        })

        it('rate-limits before the route handler parses the body, even for a malformed body', async ({ expect }) => {
            const ip = '203.0.113.70'
            for (let i = 0; i < 5; i++) {
                const response = await callAsApp(
                    new Request('https://example.com/api/invites/accept', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
                        body: 'not valid json at all'
                    })
                )
                expect(response.status).not.toBe(429)
            }
            const sixth = await callAsApp(
                new Request('https://example.com/api/invites/accept', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
                    body: 'not valid json at all'
                })
            )
            expect(sixth.status).toBe(429)
        })
    })

    describe('consumeRateLimit concurrency', () => {
        it('allows exactly max concurrent requests to succeed, never more', async ({ expect }) => {
            const { createDb } = await import('../worker/db/client.js')
            const { consumeRateLimit } = await import('../worker/rate-limit.js')
            const db = createDb(env.OIDC_DB)
            const key = `concurrency-test|${crypto.randomUUID()}`

            const results = await Promise.all(Array.from({ length: 8 }, () => consumeRateLimit(db, key, 10, 3)))

            expect(results.filter(Boolean).length).toBe(3)
        })
    })
})
