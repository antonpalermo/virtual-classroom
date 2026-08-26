import { afterAll, afterEach, beforeAll, describe, it } from 'vitest'
import { callAsApp } from './helpers/call-app'
import { googleNetwork, mockGoogleAccount } from './helpers/google-network'

beforeAll(() => googleNetwork.enable())
afterEach(() => googleNetwork.resetHandlers())
afterAll(() => googleNetwork.disable())

function base64url(bytes: ArrayBuffer) {
    return btoa(String.fromCharCode(...new Uint8Array(bytes)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')
}

// The oauth-provider plugin's registered clients default to `require_pkce: true`
// (confirmed against node_modules/@better-auth/oauth-provider — /oauth2/authorize
// rejects a request with no code_challenge as "pkce is required for this client"),
// so a real authorization-code flow against a plugin-created client must generate
// and send a PKCE pair.
async function generatePkcePair() {
    const codeVerifier = base64url(crypto.getRandomValues(new Uint8Array(32)).buffer)
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier))
    const codeChallenge = base64url(digest)
    return { codeVerifier, codeChallenge }
}

async function signInWithGoogle(profile: { sub: string; email: string; name: string }) {
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

    const signInResponse = await callAsApp(
        new Request(`https://example.com/api/auth/callback/google?code=test-code&state=${state}`, {
            headers: { cookie: stateCookie }
        })
    )
    const cookie = signInResponse.headers
        .getSetCookie()
        .find(entry => entry.includes('session_token'))
        ?.split(';')[0]
    if (!cookie) throw new Error('expected a session cookie from sign-in')
    return cookie
}

describe('OAuth provider (linking a new application)', () => {
    it('lets a signed-in user register a client, then completes the authorization-code flow for it', async ({ expect }) => {
        const cookie = await signInWithGoogle({ sub: 'google-4', email: 'imogen@example.com', name: 'Imogen' })

        const createClientResponse = await callAsApp(
            new Request('https://example.com/api/auth/oauth2/create-client', {
                method: 'POST',
                // Better Auth's origin-check middleware requires an Origin header whenever a
                // cookie is present on a non-GET request (same CSRF protection Task 3 found on
                // sign-out); a real browser fetch() sends this automatically.
                headers: { cookie, origin: 'https://example.com', 'content-type': 'application/json' },
                // `skip_consent` is intentionally omitted: the plugin's regular, authenticated
                // /oauth2/create-client endpoint's zod body schema doesn't include that field (it
                // would be silently stripped if sent) — only the privileged, still-session-gated
                // /admin/oauth2/create-client endpoint accepts it. See the comment below the
                // authorize call for the real-consent flow this requires instead.
                body: JSON.stringify({ redirect_uris: ['https://linked-app.example.com/callback'] })
            })
        )
        expect(createClientResponse.status).toBeLessThan(300)
        const client = await createClientResponse.json<{ client_id: string; client_secret: string }>()
        expect(client.client_id).toBeTruthy()

        const { codeVerifier, codeChallenge } = await generatePkcePair()
        const authorizeClientResponse = await callAsApp(
            new Request(
                `https://example.com/api/auth/oauth2/authorize?response_type=code&client_id=${client.client_id}&redirect_uri=${encodeURIComponent(
                    'https://linked-app.example.com/callback'
                )}&scope=openid%20profile%20email&code_challenge=${codeChallenge}&code_challenge_method=S256`,
                { headers: { cookie } }
            )
        )
        // The client created above has no `skip_consent` (the plugin's regular, authenticated
        // /oauth2/create-client endpoint doesn't accept that field at all — it's zod-stripped;
        // only the privileged /admin/oauth2/create-client accepts it, confirmed against
        // node_modules/@better-auth/oauth-provider/dist/authorize-Crqw4_bR.mjs:2670-2695 vs.
        // :2499-2528), so /oauth2/authorize redirects to the configured consentPage instead of
        // issuing a code directly. Complete the real user-consent step: the redirect's query
        // string is an HMAC-signed `oauth_query` (see the `oauth_query`-matched `before` hook at
        // :4437-4463) that a consent page is expected to echo back verbatim to /oauth2/consent
        // alongside `accept: true`; the response shape it comes back with is verified below.
        const consentRedirect = authorizeClientResponse.headers.get('location')
        if (!consentRedirect) throw new Error('expected a redirect to the consent page')
        const consentUrl = new URL(consentRedirect, 'https://example.com')
        expect(consentUrl.pathname).toBe('/consent')

        const consentResponse = await callAsApp(
            new Request('https://example.com/api/auth/oauth2/consent', {
                method: 'POST',
                headers: { cookie, origin: 'https://example.com', 'content-type': 'application/json' },
                body: JSON.stringify({ accept: true, oauth_query: consentUrl.search.slice(1) })
            })
        )
        expect(consentResponse.status).toBe(200)
        // The endpoint's OpenAPI doc (in node_modules/@better-auth/oauth-provider) describes the
        // response as `{ redirect_uri }`, but the actual handler (consentEndpoint calling
        // handleRedirect, :5322-5328) returns `{ redirect: true, url }` — the doc is stale.
        const { url: redirectUri } = await consentResponse.json<{ redirect: boolean; url: string }>()
        if (!redirectUri) throw new Error('expected a url with an authorization code from /oauth2/consent')
        const code = new URL(redirectUri).searchParams.get('code')
        if (!code) throw new Error('expected an authorization code in the redirect_uri')

        // Registered clients default to `token_endpoint_auth_method: client_secret_basic`
        // (confirmed by the actual /oauth2/token error when credentials were sent as body
        // params instead: "client registered for client_secret_basic cannot use
        // client_secret_post") — so the client authenticates via HTTP Basic auth, not
        // client_id/client_secret in the body.
        const tokenResponse = await callAsApp(
            new Request('https://example.com/api/auth/oauth2/token', {
                method: 'POST',
                headers: {
                    'content-type': 'application/x-www-form-urlencoded',
                    authorization: `Basic ${btoa(`${client.client_id}:${client.client_secret}`)}`
                },
                body: new URLSearchParams({
                    grant_type: 'authorization_code',
                    code,
                    redirect_uri: 'https://linked-app.example.com/callback',
                    code_verifier: codeVerifier
                })
            })
        )
        expect(tokenResponse.status).toBe(200)
        const tokens = await tokenResponse.json<{ access_token: string }>()
        expect(tokens.access_token).toBeTruthy()

        const userinfoResponse = await callAsApp(
            new Request('https://example.com/api/auth/oauth2/userinfo', {
                headers: { authorization: `Bearer ${tokens.access_token}` }
            })
        )
        expect(userinfoResponse.status).toBe(200)
        const userinfo = await userinfoResponse.json<{ email: string }>()
        expect(userinfo.email).toBe('imogen@example.com')
    })
})
