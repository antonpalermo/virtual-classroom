import { createPkcePair } from './pkce'

const JWT_STORAGE_KEY = 'client_jwt'

export function getStoredJwt() {
    try {
        return sessionStorage.getItem(JWT_STORAGE_KEY) ?? undefined
    } catch {
        return undefined
    }
}

export function storeJwt(jwt: string) {
    try {
        sessionStorage.setItem(JWT_STORAGE_KEY, jwt)
    } catch {
        // sessionStorage can throw in a locked-down browser; nothing to recover here.
    }
}

export function clearStoredJwt() {
    try {
        sessionStorage.removeItem(JWT_STORAGE_KEY)
    } catch {
        // sessionStorage can throw in a locked-down browser; nothing to recover here.
    }
}

const OIDC_ORIGIN = import.meta.env.VITE_OIDC_ORIGIN ?? 'http://localhost:8791'
const CLIENT_ID = import.meta.env.VITE_OIDC_CLIENT_ID ?? ''

const RETURN_TO_KEY = 'oidc_return_to'

// Consumes the path redirectToSignIn stashed. Only same-origin paths ('/x', never '//host' or
// 'https://…') come back, so a tampered value can't turn this into an open redirect.
export function takeReturnTo() {
    const returnTo = sessionStorage.getItem(RETURN_TO_KEY)
    sessionStorage.removeItem(RETURN_TO_KEY)
    return returnTo?.startsWith('/') && !returnTo.startsWith('//') && !returnTo.startsWith('/\\') ? returnTo : '/'
}

// Sends the browser straight to worker-oidc's /login (via its authorize endpoint) — this app has
// no sign-in page of its own. src/routes/auth-callback.tsx finishes the exchange.
export async function redirectToSignIn() {
    const { codeVerifier, codeChallenge } = await createPkcePair()
    const state = crypto.randomUUID()
    sessionStorage.setItem('oidc_code_verifier', codeVerifier)
    sessionStorage.setItem('oidc_state', state)
    // Remember the deep link so auth-callback can return to it. A retry from /auth-callback itself
    // keeps the path stashed by the original attempt.
    if (window.location.pathname !== '/auth-callback') {
        sessionStorage.setItem(RETURN_TO_KEY, window.location.pathname + window.location.search)
    }

    const params = new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: `${window.location.origin}/auth-callback`,
        response_type: 'code',
        scope: 'openid email profile',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state,
        // Signing out only clears the stored token, so a still-live worker-oidc session cookie —
        // e.g. from a worker-admin sign-in on the same browser — would otherwise be silently reused.
        prompt: 'login'
    })
    window.location.href = `${OIDC_ORIGIN}/api/auth/oauth2/authorize?${params.toString()}`
}
