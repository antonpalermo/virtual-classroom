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
})
