import { type AccessTokenClaims, verifyAccessToken } from '@capstone/auth-verify'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { clearStoredJwt, getStoredJwt } from '../lib/auth-client'

const OIDC_ORIGIN = import.meta.env.VITE_OIDC_ORIGIN ?? 'http://localhost:8791'
const JWKS_URL = `${OIDC_ORIGIN}/api/auth/jwks`

export const Route = createFileRoute('/')({
    beforeLoad: () => {
        if (!getStoredJwt()) throw redirect({ to: '/login' })
    },
    component: DashboardRoute
})

function DashboardRoute() {
    // `beforeLoad` only proves a token *string* is in sessionStorage, not that it still
    // verifies — so still-resolving, resolved-but-invalid, and resolved-with-claims stay
    // distinct states here, same as before this rewrite.
    const [claims, setClaims] = useState<AccessTokenClaims | null | undefined>(undefined)
    const navigate = useNavigate()

    useEffect(() => {
        const jwt = getStoredJwt()
        if (!jwt) return
        verifyAccessToken(jwt, JWKS_URL).then(setClaims)
    }, [])

    const isPending = claims === undefined
    const tokenIsStale = !isPending && !claims

    useEffect(() => {
        if (!tokenIsStale) return
        clearStoredJwt()
        navigate({ to: '/login' })
    }, [tokenIsStale, navigate])

    function signOut() {
        clearStoredJwt()
        navigate({ to: '/login' })
    }

    if (isPending) return <p className="p-2">Loading…</p>
    if (tokenIsStale) return <p className="p-2">Your session has expired. Redirecting to sign in…</p>

    return (
        <div className="p-2">
            <p>Signed in as {claims?.email}</p>
            {claims?.role === 'admin' && (
                <p>
                    <a href="/users">Manage users</a>
                </p>
            )}
            <button type="button" onClick={signOut}>
                Sign out
            </button>
        </div>
    )
}
