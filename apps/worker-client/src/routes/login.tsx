import { createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'
import { authClient } from '../lib/auth-client'

// worker-admin's origin(s) allowed to receive a bearer token via this round-trip. A bearer
// token is a live credential, so this list must stay an explicit allowlist, never a
// pattern/prefix check that could be satisfied by an attacker-controlled host.
const ALLOWED_RETURN_ORIGINS = ['http://localhost:8790']

function isAllowedReturnTo(returnTo: string) {
    return ALLOWED_RETURN_ORIGINS.some(origin => returnTo === origin || returnTo.startsWith(`${origin}/`))
}

export const Route = createFileRoute('/login')({
    validateSearch: (search: Record<string, unknown>): { returnTo?: string } => ({
        returnTo: typeof search.returnTo === 'string' ? search.returnTo : undefined
    }),
    component: LoginRoute
})

function LoginRoute() {
    const { returnTo } = Route.useSearch()

    useEffect(() => {
        if (!returnTo || !isAllowedReturnTo(returnTo)) return
        if (!window.location.hash.startsWith('#token=')) return
        window.location.href = `${returnTo}${window.location.hash}`
    }, [returnTo])

    return (
        <div className="p-2">
            <h3>Sign in</h3>
            <button
                type="button"
                onClick={() =>
                    authClient.signIn.social({
                        provider: 'google',
                        callbackURL: returnTo ? `/login?returnTo=${encodeURIComponent(returnTo)}` : '/'
                    })
                }
            >
                Sign in with Google
            </button>
        </div>
    )
}
