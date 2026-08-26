import { setupNetwork } from '@msw/cloudflare'
import { HttpResponse, http } from 'msw'

export const googleNetwork = setupNetwork()

// Better Auth's Google provider derives the signed-in user from the token response's
// `id_token` claims (via `jose`'s unverified `decodeJwt`) rather than calling the userinfo
// endpoint, so the mocked token exchange must return a well-formed (3-segment) JWT whose
// payload carries the profile claims. The header and signature segments are never inspected.
function base64url(value: unknown) {
    const json = JSON.stringify(value)
    const base64 = btoa(unescape(encodeURIComponent(json)))
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fakeGoogleIdToken(profile: { sub: string; email: string; name: string }) {
    const header = base64url({ alg: 'none', typ: 'JWT' })
    const payload = base64url({
        sub: profile.sub,
        email: profile.email,
        email_verified: true,
        name: profile.name
    })
    return `${header}.${payload}.signature`
}

export function mockGoogleAccount(profile: { sub: string; email: string; name: string }) {
    googleNetwork.use(
        http.post('https://oauth2.googleapis.com/token', () =>
            HttpResponse.json({
                access_token: 'test-access-token',
                token_type: 'Bearer',
                expires_in: 3600,
                scope: 'openid email profile',
                id_token: fakeGoogleIdToken(profile)
            })
        ),
        http.get('https://www.googleapis.com/oauth2/v3/userinfo', () => HttpResponse.json(profile))
    )
}
