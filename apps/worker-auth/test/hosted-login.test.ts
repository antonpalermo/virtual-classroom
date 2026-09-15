import { decodeJwt } from 'jose'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { callAsApp } from './helpers/call-app'
import { googleNetwork, mockGoogleAccount } from './helpers/google-network'

const RETURN_ORIGIN = 'https://client.example.test'
const RETURN_TO = `${RETURN_ORIGIN}/auth-callback`

beforeAll(() => googleNetwork.enable())
afterEach(() => googleNetwork.resetHandlers())
afterAll(() => googleNetwork.disable())

describe('GET /login', () => {
    it('rejects a returnTo that is not on the allowlist', async () => {
        const response = await callAsApp(new Request('https://example.com/login?returnTo=https://evil.example.test/steal'), {
            ALLOWED_RETURN_ORIGINS: RETURN_ORIGIN
        })
        expect(response.status).toBe(400)
    })

    it('renders the sign-in page for an allowlisted returnTo', async () => {
        const response = await callAsApp(new Request(`https://example.com/login?returnTo=${encodeURIComponent(RETURN_TO)}`), {
            ALLOWED_RETURN_ORIGINS: RETURN_ORIGIN
        })
        expect(response.status).toBe(200)
        const html = await response.text()
        expect(html).toContain('Sign in with Google')
    })
})

describe('GET /login/complete', () => {
    async function completeGoogleSignIn(profile: { sub: string; email: string; name: string }, callbackURL: string) {
        mockGoogleAccount(profile)

        const authorizeResponse = await callAsApp(
            new Request('https://example.com/api/auth/sign-in/social', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ provider: 'google', callbackURL })
            })
        )
        const { url } = await authorizeResponse.json<{ url: string }>()
        const state = new URL(url).searchParams.get('state')
        const stateCookie = authorizeResponse.headers.get('set-cookie')?.split(';')[0]

        return callAsApp(
            new Request(`https://example.com/api/auth/callback/google?code=test-code&state=${state}`, {
                headers: { cookie: stateCookie ?? '' }
            })
        )
    }

    it('redirects to returnTo with a JWT and the bearer session token on the fragment', async () => {
        const profile = { sub: 'google-1', email: 'user@example.com', name: 'Test User' }
        const callbackResponse = await completeGoogleSignIn(profile, `/login/complete?returnTo=${encodeURIComponent(RETURN_TO)}`)

        // Better Auth's bearer plugin only mints `set-auth-token` alongside a *new* session
        // cookie (see the comment in test/admin.test.ts), and its value is literally the
        // session cookie's own value — asserted below via sessionCookieValue rather than this
        // header, since /login/complete now reads the token straight off the Cookie header.
        expect(callbackResponse.headers.get('set-auth-token')).toBeTruthy()

        const sessionCookie = callbackResponse.headers
            .getSetCookie()
            .find(entry => entry.includes('session_token'))
            ?.split(';')[0]
        expect(sessionCookie).toBeTruthy()
        const sessionCookieValue = sessionCookie?.slice(sessionCookie.indexOf('=') + 1)

        const completeUrl = new URL(callbackResponse.headers.get('location') ?? '', 'https://example.com')

        const completeResponse = await callAsApp(new Request(completeUrl, { headers: { cookie: sessionCookie ?? '' } }), {
            ALLOWED_RETURN_ORIGINS: RETURN_ORIGIN
        })

        expect(completeResponse.status).toBe(302)
        const finalLocation = completeResponse.headers.get('location') ?? ''
        expect(finalLocation.startsWith(RETURN_TO)).toBe(true)

        const fragment = new URL(finalLocation).hash.slice(1)
        const params = new URLSearchParams(fragment)
        const jwt = params.get('token')
        expect(jwt).toBeTruthy()
        expect(params.get('session')).toBe(sessionCookieValue)

        const claims = decodeJwt(jwt ?? '')
        expect(claims.email).toBe(profile.email)
        expect(claims.role).toBe('user')
    })

    it('rejects a returnTo that is not on the allowlist', async () => {
        const response = await callAsApp(
            new Request('https://example.com/login/complete?returnTo=https://evil.example.test/steal&session=whatever'),
            { ALLOWED_RETURN_ORIGINS: RETURN_ORIGIN }
        )
        expect(response.status).toBe(400)
    })

    it('rejects an allowlisted returnTo with no session cookie', async () => {
        const response = await callAsApp(new Request(`https://example.com/login/complete?returnTo=${encodeURIComponent(RETURN_TO)}`), {
            ALLOWED_RETURN_ORIGINS: RETURN_ORIGIN
        })
        expect(response.status).toBe(401)
    })
})
