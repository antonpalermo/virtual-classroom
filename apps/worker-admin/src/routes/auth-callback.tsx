import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { storeJwt } from '../lib/auth-client'

const OIDC_ORIGIN = import.meta.env.VITE_OIDC_ORIGIN ?? 'http://localhost:8791'
const CLIENT_ID = import.meta.env.VITE_OIDC_CLIENT_ID ?? ''

export const Route = createFileRoute('/auth-callback')({
    component: AuthCallbackRoute
})

function AuthCallbackRoute() {
    const navigate = useNavigate()

    useEffect(() => {
        async function exchangeCode() {
            const params = new URLSearchParams(window.location.search)
            const code = params.get('code')
            const state = params.get('state')
            const expectedState = sessionStorage.getItem('oidc_state')
            const codeVerifier = sessionStorage.getItem('oidc_code_verifier')
            sessionStorage.removeItem('oidc_state')
            sessionStorage.removeItem('oidc_code_verifier')

            if (!code || !state || !codeVerifier || state !== expectedState) {
                navigate({ to: '/login' })
                return
            }

            const response = await fetch(`${OIDC_ORIGIN}/api/auth/oauth2/token`, {
                method: 'POST',
                headers: { 'content-type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    grant_type: 'authorization_code',
                    code,
                    redirect_uri: `${window.location.origin}/auth-callback`,
                    client_id: CLIENT_ID,
                    code_verifier: codeVerifier
                })
            })
            if (!response.ok) {
                navigate({ to: '/login' })
                return
            }
            const tokens = (await response.json()) as { id_token?: string }
            if (!tokens.id_token) {
                navigate({ to: '/login' })
                return
            }
            storeJwt(tokens.id_token)
            navigate({ to: '/' })
        }
        exchangeCode()
    }, [navigate])

    return <p className="p-2">Signing in…</p>
}
