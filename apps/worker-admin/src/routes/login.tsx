import { createFileRoute } from '@tanstack/react-router'
import { createPkcePair } from '../lib/pkce'

const OIDC_ORIGIN = import.meta.env.VITE_OIDC_ORIGIN ?? 'http://localhost:8791'
const CLIENT_ID = import.meta.env.VITE_OIDC_CLIENT_ID ?? ''

export const Route = createFileRoute('/login')({
    component: LoginRoute
})

function LoginRoute() {
    async function signIn() {
        const { codeVerifier, codeChallenge } = await createPkcePair()
        const state = crypto.randomUUID()
        sessionStorage.setItem('oidc_code_verifier', codeVerifier)
        sessionStorage.setItem('oidc_state', state)

        const params = new URLSearchParams({
            client_id: CLIENT_ID,
            redirect_uri: `${window.location.origin}/auth-callback`,
            response_type: 'code',
            scope: 'openid email profile',
            code_challenge: codeChallenge,
            code_challenge_method: 'S256',
            state
        })
        window.location.href = `${OIDC_ORIGIN}/api/auth/oauth2/authorize?${params.toString()}`
    }

    return (
        <div className="p-2">
            <h3>Sign in</h3>
            <button type="button" onClick={signIn}>
                Sign in
            </button>
        </div>
    )
}
