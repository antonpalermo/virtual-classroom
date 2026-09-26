import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { createDb } from '../../worker/db/client.js'
import { user as userTable } from '../../worker/db/schema.js'
import { callAsApp } from './call-app.js'

// Uses the worker-client OAuth client, not worker-admin — this helper's job is getting a real,
// verifiable id_token for any user (admin or not), and worker-admin's own authorize flow now
// rejects a non-admin before it ever reaches consent/token (see
// worker/restrict-worker-admin-client.ts). worker-client stays open to any signed-in user, so it
// doesn't collide with tests that specifically need a plain, non-admin user's token.
const REDIRECT_URI = 'https://client.example.test/auth-callback'

// Same helper apps/worker-auth/test/oauth-provider.test.ts and oauth-client-flow.test.ts use —
// registered clients default to require_pkce: true, so a real authorization-code flow needs a
// real PKCE pair.
function base64url(bytes: ArrayBuffer) {
    return btoa(String.fromCharCode(...new Uint8Array(bytes)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')
}

async function generatePkcePair() {
    const codeVerifier = base64url(crypto.getRandomValues(new Uint8Array(32)).buffer)
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier))
    const codeChallenge = base64url(digest)
    return { codeVerifier, codeChallenge }
}

async function registerWorkerClient() {
    const response = await callAsApp(
        new Request(`https://example.com/internal/oauth-clients/worker-client?redirect_uri=${encodeURIComponent(REDIRECT_URI)}`, {
            method: 'POST',
            headers: { authorization: 'Bearer test-secret' }
        }),
        { BETTER_AUTH_SECRET: 'test-secret' }
    )
    const { client_id } = await response.json<{ client_id: string }>()
    return client_id as string
}

// Seeds a user via the existing bootstrap-admin-user route (the only way to create an account
// with a known password in tests), then optionally elevates its role directly via Drizzle —
// bootstrap-admin-user.ts has no role concept, everything it creates defaults to 'user'.
export async function seedUser(email: string, password: string, opts: { role?: string; banned?: boolean } = {}) {
    const response = await callAsApp(
        new Request('https://example.com/internal/users/bootstrap-admin', {
            method: 'POST',
            headers: { authorization: 'Bearer test-secret', 'content-type': 'application/json' },
            body: JSON.stringify({ email, password, name: 'Test User' })
        }),
        { BETTER_AUTH_SECRET: 'test-secret' }
    )
    if (response.status !== 200) throw new Error(`failed to seed user: ${response.status}`)
    const { userId } = await response.json<{ userId: string }>()
    if (opts.role !== undefined || opts.banned !== undefined) {
        const db = createDb(env.OIDC_DB)
        await db
            .update(userTable)
            .set({ ...(opts.role !== undefined ? { role: opts.role } : {}), ...(opts.banned !== undefined ? { banned: opts.banned } : {}) })
            .where(eq(userTable.id, userId))
    }
    return userId as string
}

// Drives a full sign-in -> consent -> token-exchange round trip (the same steps
// oauth-client-flow.test.ts exercises manually) and returns the issued tokens, so tests needing a
// real, verifiable id_token don't each have to reimplement the OAuth dance.
export async function signInForTokens(email: string, password: string) {
    const clientId = await registerWorkerClient()
    const { codeVerifier, codeChallenge } = await generatePkcePair()

    const authorizeQuery = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        scope: 'openid email profile',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state: 'test-state'
    }).toString()

    const authorizeResponse = await callAsApp(new Request(`https://example.com/api/auth/oauth2/authorize?${authorizeQuery}`))
    const loginRedirect = new URL(authorizeResponse.headers.get('location') ?? '', 'https://example.com')

    const signInResponse = await callAsApp(
        new Request('https://example.com/api/auth/sign-in/email', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email, password })
        })
    )
    if (signInResponse.status >= 300) throw new Error(`sign-in failed: ${signInResponse.status}`)
    const cookie = signInResponse.headers
        .getSetCookie()
        .find(entry => entry.includes('session_token'))
        ?.split(';')[0]
    if (!cookie) throw new Error('expected a session cookie from sign-in')

    const resumeResponse = await callAsApp(
        new Request(`https://example.com/api/auth/oauth2/authorize${loginRedirect.search}`, { headers: { cookie } })
    )
    const consentRedirect = new URL(resumeResponse.headers.get('location') ?? '', 'https://example.com')

    const consentResponse = await callAsApp(
        new Request('https://example.com/api/auth/oauth2/consent', {
            method: 'POST',
            headers: { cookie, origin: 'https://example.com', 'content-type': 'application/json' },
            body: JSON.stringify({ accept: true, oauth_query: consentRedirect.search.slice(1) })
        })
    )
    const { url: redirectWithCode } = await consentResponse.json<{ url: string }>()
    const code = new URL(redirectWithCode).searchParams.get('code')
    if (!code) throw new Error('expected an authorization code in the redirect')

    const tokenResponse = await callAsApp(
        new Request('https://example.com/api/auth/oauth2/token', {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                redirect_uri: REDIRECT_URI,
                client_id: clientId,
                code_verifier: codeVerifier
            })
        })
    )
    if (tokenResponse.status !== 200) throw new Error(`token exchange failed: ${tokenResponse.status}`)
    return tokenResponse.json<{ access_token: string; id_token: string }>()
}
