import { createFileRoute } from '@tanstack/react-router'
import { type FormEvent, useEffect, useState } from 'react'
import { GoogleButton } from '../GoogleButton'

export const Route = createFileRoute('/login')({
    component: LoginRoute
})

// worker/restrict-worker-admin-client.ts sends this back here for either sign-in method when a
// signed-in non-admin tries to complete worker-admin's OAuth flow.
function loginError() {
    const code = new URLSearchParams(window.location.search).get('error')
    return code === 'not_authorized' ? "This account isn't authorized to sign in here." : null
}

function LoginRoute() {
    const [clientName, setClientName] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(loginError)
    const oauthQuery = window.location.search.slice(1)

    useEffect(() => {
        const clientId = new URLSearchParams(window.location.search).get('client_id')
        if (!clientId) return
        fetch('/api/auth/oauth2/public-client-prelogin', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ client_id: clientId, oauth_query: oauthQuery })
        })
            .then(response => (response.ok ? response.json() : null))
            .then((client: { client_name?: string } | null) => setClientName(client?.client_name ?? null))
            .catch(() => setClientName(null))
    }, [oauthQuery])

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        setError(null)
        const form = new FormData(event.currentTarget)
        const response = await fetch('/api/auth/sign-in/email', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: form.get('email'), password: form.get('password') })
        })
        if (!response.ok) {
            setError('Sign-in failed, please try again.')
            return
        }
        // Strip a stale ?error= (e.g. from a prior not_authorized bounce) before resuming —
        // same reasoning GoogleButton.tsx applies to its own reused query.
        const params = new URLSearchParams(oauthQuery)
        params.delete('error')
        window.location.href = `/api/auth/oauth2/authorize?${params.toString()}`
    }

    return (
        <div className="p-2">
            <h3>Sign in{clientName ? ` to continue to ${clientName}` : ''}</h3>
            <form onSubmit={handleSubmit}>
                <label>
                    Email <input type="email" name="email" required />
                </label>
                <label>
                    Password <input type="password" name="password" required />
                </label>
                <button type="submit">Sign in</button>
            </form>
            {error && <p style={{ color: 'red' }}>{error}</p>}
            <GoogleButton oauthQuery={oauthQuery} />
        </div>
    )
}
