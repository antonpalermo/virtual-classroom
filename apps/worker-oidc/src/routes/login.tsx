import { createFileRoute } from '@tanstack/react-router'
import { type FormEvent, useEffect, useState } from 'react'
import { GoogleButton } from '../GoogleButton'

export const Route = createFileRoute('/login')({
    component: LoginRoute
})

function LoginRoute() {
    const [clientName, setClientName] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
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
        window.location.href = `/api/auth/oauth2/authorize?${oauthQuery}`
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
