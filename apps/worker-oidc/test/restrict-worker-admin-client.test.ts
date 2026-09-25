import { describe, it } from 'vitest'
import { callAsApp } from './helpers/call-app.js'
import { seedUser } from './helpers/sign-in.js'

async function registerClient(name: string, redirectUri: string) {
    const response = await callAsApp(
        new Request(`https://example.com/internal/oauth-clients/${name}?redirect_uri=${encodeURIComponent(redirectUri)}`, {
            method: 'POST',
            headers: { authorization: 'Bearer test-secret' }
        }),
        { BETTER_AUTH_SECRET: 'test-secret' }
    )
    const { client_id } = await response.json<{ client_id: string }>()
    return client_id as string
}

// Same helper other test files use — registered clients default to require_pkce: true.
function base64url(bytes: ArrayBuffer) {
    return btoa(String.fromCharCode(...new Uint8Array(bytes)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')
}

async function authorizeUrl(clientId: string, redirectUri: string) {
    const codeVerifier = base64url(crypto.getRandomValues(new Uint8Array(32)).buffer)
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier))
    const codeChallenge = base64url(digest)
    const query = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: 'openid email profile',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state: 'test-state'
    }).toString()
    return `https://example.com/api/auth/oauth2/authorize?${query}`
}

async function signInAndGetCookie(email: string, password: string) {
    const response = await callAsApp(
        new Request('https://example.com/api/auth/sign-in/email', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email, password })
        })
    )
    const cookie = response.headers
        .getSetCookie()
        .find(entry => entry.includes('session_token'))
        ?.split(';')[0]
    if (!cookie) throw new Error('expected a session cookie from sign-in')
    return cookie
}

describe('restricting worker-admin sign-in to admins', () => {
    it("redirects a non-admin's resumed authorize call for worker-admin back to /login with an error, not /consent", async ({ expect }) => {
        const clientId = await registerClient('worker-admin', 'https://admin.example.test/auth-callback')
        await seedUser('plain-restrict@example.com', 'correct-horse-battery')
        const cookie = await signInAndGetCookie('plain-restrict@example.com', 'correct-horse-battery')

        const url = await authorizeUrl(clientId, 'https://admin.example.test/auth-callback')
        const response = await callAsApp(new Request(url, { headers: { cookie } }))

        expect(response.status).toBeGreaterThanOrEqual(300)
        expect(response.status).toBeLessThan(400)
        const location = new URL(response.headers.get('location') ?? '', 'https://example.com')
        expect(location.pathname).toBe('/login')
        expect(location.searchParams.get('error')).toBe('not_authorized')
    })

    it("lets an admin's resumed authorize call for worker-admin proceed to /consent as normal", async ({ expect }) => {
        const clientId = await registerClient('worker-admin', 'https://admin.example.test/auth-callback')
        await seedUser('admin-restrict@example.com', 'correct-horse-battery', { role: 'admin' })
        const cookie = await signInAndGetCookie('admin-restrict@example.com', 'correct-horse-battery')

        const url = await authorizeUrl(clientId, 'https://admin.example.test/auth-callback')
        const response = await callAsApp(new Request(url, { headers: { cookie } }))

        expect(response.status).toBeGreaterThanOrEqual(300)
        expect(response.status).toBeLessThan(400)
        const location = new URL(response.headers.get('location') ?? '', 'https://example.com')
        expect(location.pathname).toBe('/consent')
    })

    it("does not restrict worker-client's authorize flow for a non-admin account", async ({ expect }) => {
        const clientId = await registerClient('worker-client', 'https://client.example.test/auth-callback')
        await seedUser('plain-client-restrict@example.com', 'correct-horse-battery')
        const cookie = await signInAndGetCookie('plain-client-restrict@example.com', 'correct-horse-battery')

        const url = await authorizeUrl(clientId, 'https://client.example.test/auth-callback')
        const response = await callAsApp(new Request(url, { headers: { cookie } }))

        expect(response.status).toBeGreaterThanOrEqual(300)
        expect(response.status).toBeLessThan(400)
        const location = new URL(response.headers.get('location') ?? '', 'https://example.com')
        expect(location.pathname).toBe('/consent')
    })

    it('passes through to the existing /login redirect when there is no session yet', async ({ expect }) => {
        const clientId = await registerClient('worker-admin', 'https://admin.example.test/auth-callback')
        const url = await authorizeUrl(clientId, 'https://admin.example.test/auth-callback')

        const response = await callAsApp(new Request(url))

        expect(response.status).toBeGreaterThanOrEqual(300)
        expect(response.status).toBeLessThan(400)
        const location = new URL(response.headers.get('location') ?? '', 'https://example.com')
        expect(location.pathname).toBe('/login')
        expect(location.searchParams.has('error')).toBe(false)
    })
})
