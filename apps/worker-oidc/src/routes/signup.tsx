import { createFileRoute } from '@tanstack/react-router'
import { type FormEvent, useEffect, useState } from 'react'

export const Route = createFileRoute('/signup')({
    component: SignupRoute
})

function SignupRoute() {
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
        const signUpResponse = await fetch('/api/auth/sign-up/email', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: form.get('name'), email: form.get('email'), password: form.get('password') })
        })
        if (!signUpResponse.ok) {
            setError('Sign-up failed, please try again.')
            return
        }
        const continueResponse = await fetch('/api/auth/oauth2/continue', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ created: true, oauth_query: oauthQuery })
        })
        if (!continueResponse.ok) {
            setError('Could not continue sign-in, please try again.')
            return
        }
        const { url } = (await continueResponse.json()) as { url: string }
        window.location.href = url
    }

    return (
        <div className="p-2">
            <h3>Sign up{clientName ? ` to continue to ${clientName}` : ''}</h3>
            <form onSubmit={handleSubmit}>
                <label>
                    Name <input type="text" name="name" required />
                </label>
                <label>
                    Email <input type="email" name="email" required />
                </label>
                <label>
                    Password <input type="password" name="password" required />
                </label>
                <button type="submit">Sign up</button>
            </form>
            {error && <p style={{ color: 'red' }}>{error}</p>}
        </div>
    )
}
