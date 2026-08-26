import { env } from 'cloudflare:workers'
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest'
import { callAsApp } from './helpers/call-app'
import { googleNetwork, mockGoogleAccount } from './helpers/google-network'

beforeAll(() => googleNetwork.enable())
afterEach(() => googleNetwork.resetHandlers())
afterAll(() => googleNetwork.disable())

async function completeGoogleSignIn(profile: { sub: string; email: string; name: string }) {
    mockGoogleAccount(profile)

    const authorizeResponse = await callAsApp(
        new Request('https://example.com/api/auth/sign-in/social', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ provider: 'google', callbackURL: 'https://example.com/' })
        })
    )
    const { url } = await authorizeResponse.json<{ url: string }>()
    if (!url) throw new Error('expected an authorize URL from /api/auth/sign-in/social')
    const state = new URL(url).searchParams.get('state')
    const stateCookie = authorizeResponse.headers.get('set-cookie')?.split(';')[0]
    if (!stateCookie) throw new Error('expected a state cookie from /api/auth/sign-in/social')

    return callAsApp(
        new Request(`https://example.com/api/auth/callback/google?code=test-code&state=${state}`, {
            headers: { cookie: stateCookie }
        })
    )
}

describe('Google sign-in', () => {
    it('redirects to Google with the expected client_id, redirect_uri, and scope', async ({ expect }) => {
        const response = await callAsApp(
            new Request('https://example.com/api/auth/sign-in/social', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ provider: 'google', callbackURL: 'https://example.com/' })
            })
        )
        const { url } = await response.json<{ url: string }>()
        if (!url) throw new Error('expected an authorize URL')
        const params = new URL(url).searchParams

        expect(url).toMatch(/^https:\/\/accounts\.google\.com\//)
        expect(params.get('client_id')).toBeTruthy()
        expect(params.get('redirect_uri')).toContain('/api/auth/callback/google')
        expect(params.get('scope')).toContain('email')
    })

    it('creates a new user, account, and session on first sign-in', async ({ expect }) => {
        const response = await completeGoogleSignIn({ sub: 'google-1', email: 'ada@example.com', name: 'Ada' })

        expect(response.status).toBeLessThan(400)
        expect(response.headers.get('set-cookie')).toBeTruthy()

        const { results: users } = await env.AUTH_DB.prepare('SELECT * FROM user WHERE email = ?')
            .bind('ada@example.com')
            .all<{ role: string }>()
        expect(users).toHaveLength(1)
        expect(users[0]?.role).toBe('user')
    })

    it('reuses the same user on a returning sign-in, without creating a duplicate', async ({ expect }) => {
        await completeGoogleSignIn({ sub: 'google-2', email: 'grace@example.com', name: 'Grace' })
        await completeGoogleSignIn({ sub: 'google-2', email: 'grace@example.com', name: 'Grace' })

        const { results: users } = await env.AUTH_DB.prepare('SELECT * FROM user WHERE email = ?').bind('grace@example.com').all()
        expect(users).toHaveLength(1)
    })

    it('returns the signed-in user from get-session, and clears it on sign-out', async ({ expect }) => {
        const signInResponse = await completeGoogleSignIn({ sub: 'google-3', email: 'lin@example.com', name: 'Lin' })
        // The callback response sets more than one cookie (it also clears the OAuth state
        // cookie), so pick the session cookie out of the full set rather than assuming it's first.
        const cookie = signInResponse.headers
            .getSetCookie()
            .find(entry => entry.includes('session_token'))
            ?.split(';')[0]
        if (!cookie) throw new Error('expected a session cookie from sign-in')

        const sessionResponse = await callAsApp(new Request('https://example.com/api/auth/get-session', { headers: { cookie } }))
        const session = await sessionResponse.json<{ user: { email: string; role: string } }>()
        expect(session.user.email).toBe('lin@example.com')
        expect(session.user.role).toBe('user')

        // Better Auth's sign-out endpoint requires an Origin header for CSRF protection
        // (real browser fetch() calls send this automatically; a synthetic Request doesn't).
        await callAsApp(
            new Request('https://example.com/api/auth/sign-out', {
                method: 'POST',
                headers: { cookie, origin: 'https://example.com' }
            })
        )

        const afterSignOut = await callAsApp(new Request('https://example.com/api/auth/get-session', { headers: { cookie } }))
        expect(await afterSignOut.json()).toBeNull()
    })
})
