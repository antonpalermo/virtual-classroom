import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { describe, it } from 'vitest'
import { createDb } from '../worker/db/client.js'
import { user } from '../worker/db/schema.js'
import { callAsApp } from './helpers/call-app.js'

const REDIRECT_URI = 'https://admin.example.test/auth-callback'

function base64url(bytes: ArrayBuffer) {
    return btoa(String.fromCharCode(...new Uint8Array(bytes)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')
}

// Same helper apps/worker-auth/test/oauth-provider.test.ts uses — registered clients default to
// require_pkce: true, so a real authorization-code flow needs a real PKCE pair.
async function generatePkcePair() {
    const codeVerifier = base64url(crypto.getRandomValues(new Uint8Array(32)).buffer)
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier))
    const codeChallenge = base64url(digest)
    return { codeVerifier, codeChallenge }
}

async function registerWorkerAdminClient() {
    const response = await callAsApp(
        new Request(`https://example.com/internal/oauth-clients/worker-admin?redirect_uri=${encodeURIComponent(REDIRECT_URI)}`, {
            method: 'POST',
            headers: { authorization: 'Bearer test-secret' }
        }),
        { BETTER_AUTH_SECRET: 'test-secret' }
    )
    const { client_id } = await response.json<{ client_id: string }>()
    return client_id as string
}

// /sign-up/email is disabled entirely (see disabledPaths in worker/auth.ts) — an account has to
// already exist, same as it would via a real worker/bootstrap-admin-user.ts call.
//
// "Admin" here is the bootstrap-script sense (the operator seeding the very first account), not
// the role column worker/restrict-worker-admin-client.ts checks — those are different concepts
// that happen to share a name. bootstrap-admin-user.ts doesn't set role (defaults to 'user'), so
// this test's own account needs elevating too, or its worker-admin flow would now be rejected by
// that gate before ever reaching /consent.
async function seedAdminUser(email: string, password: string) {
    const response = await callAsApp(
        new Request('https://example.com/internal/users/bootstrap-admin', {
            method: 'POST',
            headers: { authorization: 'Bearer test-secret', 'content-type': 'application/json' },
            body: JSON.stringify({ email, password, name: 'Test Admin' })
        }),
        { BETTER_AUTH_SECRET: 'test-secret' }
    )
    if (response.status !== 200) throw new Error(`failed to seed admin user: ${response.status}`)
    const db = createDb(env.OIDC_DB)
    await db.update(user).set({ role: 'admin' }).where(eq(user.email, email))
}

describe('OAuth client flow (worker-admin against worker-oidc)', () => {
    it('completes sign-in, consent, and token exchange for the registered public client', async ({ expect }) => {
        const clientId = await registerWorkerAdminClient()
        const { codeVerifier, codeChallenge } = await generatePkcePair()

        await seedAdminUser('admin@example.com', 'correct-horse-battery')

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
        expect(authorizeResponse.status).toBeGreaterThanOrEqual(300)
        expect(authorizeResponse.status).toBeLessThan(400)
        const loginRedirect = new URL(authorizeResponse.headers.get('location') ?? '', 'https://example.com')
        expect(loginRedirect.pathname).toBe('/login')

        const signInResponse = await callAsApp(
            new Request('https://example.com/api/auth/sign-in/email', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ email: 'admin@example.com', password: 'correct-horse-battery' })
            })
        )
        expect(signInResponse.status).toBeLessThan(300)
        const cookie = signInResponse.headers
            .getSetCookie()
            .find((entry: string) => entry.includes('session_token'))
            ?.split(';')[0]
        if (!cookie) throw new Error('expected a session cookie from sign-in')

        // Mirrors what src/routes/login.tsx does after a successful sign-in: replay the exact
        // signed query string /login received back onto /oauth2/authorize.
        const resumeResponse = await callAsApp(
            new Request(`https://example.com/api/auth/oauth2/authorize${loginRedirect.search}`, { headers: { cookie } })
        )
        expect(resumeResponse.status).toBeGreaterThanOrEqual(300)
        expect(resumeResponse.status).toBeLessThan(400)
        const consentRedirect = new URL(resumeResponse.headers.get('location') ?? '', 'https://example.com')
        expect(consentRedirect.pathname).toBe('/consent')

        const consentResponse = await callAsApp(
            new Request('https://example.com/api/auth/oauth2/consent', {
                method: 'POST',
                headers: { cookie, origin: 'https://example.com', 'content-type': 'application/json' },
                body: JSON.stringify({ accept: true, oauth_query: consentRedirect.search.slice(1) })
            })
        )
        expect(consentResponse.status).toBe(200)
        const { url: redirectWithCode } = await consentResponse.json<{ redirect: boolean; url: string }>()
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
        expect(tokenResponse.status).toBe(200)
        const tokens = await tokenResponse.json<{ access_token: string; id_token: string }>()
        expect(tokens.access_token).toBeTruthy()
        expect(tokens.id_token).toBeTruthy()
    })

    it('sign-up is disabled entirely — /sign-up/email 404s regardless of caller', async ({ expect }) => {
        const signUpResponse = await callAsApp(
            new Request('https://example.com/api/auth/sign-up/email', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ name: 'Sneaky', email: 'sneaky@example.com', password: 'correct-horse-battery' })
            })
        )
        expect(signUpResponse.status).toBe(404)
    })

    it('resolves the requesting client name via public-client-prelogin', async ({ expect }) => {
        // Regression for allowPublicClientPrelogin: true in worker/auth.ts — without it this
        // endpoint unconditionally 400s and src/routes/{login,consent}.tsx silently fall
        // back to showing the raw client_id instead of the client's display name.
        const clientId = await registerWorkerAdminClient()
        const { codeChallenge } = await generatePkcePair()

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
        expect(loginRedirect.pathname).toBe('/login')

        const prelookupResponse = await callAsApp(
            new Request('https://example.com/api/auth/oauth2/public-client-prelogin', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ client_id: clientId, oauth_query: loginRedirect.search.slice(1) })
            })
        )
        expect(prelookupResponse.status).toBe(200)
        const { client_name: prelookupClientName } = await prelookupResponse.json<{ client_name: string }>()
        expect(prelookupClientName).toBe('worker-admin')
    })

    it('accepts the signed oauth_query on sign-in/social and rejects a tampered one', async ({ expect }) => {
        // src/GoogleButton.tsx sends oauth_query so the oauth-provider plugin tracks the flow
        // (prompt=login / max_age handling) instead of just replaying callbackURL.
        const clientId = await registerWorkerAdminClient()
        const { codeChallenge } = await generatePkcePair()
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
        const signedQuery = new URL(authorizeResponse.headers.get('location') ?? '', 'https://example.com').search.slice(1)

        const socialSignIn = (oauthQuery: string) =>
            callAsApp(
                new Request('https://example.com/api/auth/sign-in/social', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                        provider: 'google',
                        callbackURL: `/api/auth/oauth2/authorize?${oauthQuery}`,
                        errorCallbackURL: `/login?${oauthQuery}`,
                        oauth_query: oauthQuery
                    })
                }),
                { BETTER_AUTH_URL: 'https://example.com', GOOGLE_CLIENT_ID: 'test-client-id', GOOGLE_CLIENT_SECRET: 'test-client-secret' }
            )

        const valid = await socialSignIn(signedQuery)
        expect(valid.status).toBe(200)
        expect(new URL((await valid.json<{ url: string }>()).url).origin).toBe('https://accounts.google.com')

        const tampered = await socialSignIn(signedQuery.replace('test-state', 'other-state'))
        expect(tampered.status).toBe(400)
    })
})
