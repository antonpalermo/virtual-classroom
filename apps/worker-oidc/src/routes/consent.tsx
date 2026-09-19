import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

export const Route = createFileRoute('/consent')({
    component: ConsentRoute
})

function ConsentRoute() {
    const params = new URLSearchParams(window.location.search)
    const clientId = params.get('client_id') ?? ''
    const scope = params.get('scope') ?? ''
    const oauthQuery = window.location.search.slice(1)

    const [clientName, setClientName] = useState(clientId)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!clientId) return
        fetch('/api/auth/oauth2/public-client-prelogin', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ client_id: clientId, oauth_query: oauthQuery })
        })
            .then(response => (response.ok ? response.json() : null))
            .then((client: { client_name?: string } | null) => {
                if (client?.client_name) setClientName(client.client_name)
            })
            .catch(() => {})
    }, [clientId, oauthQuery])

    async function respond(accept: boolean) {
        setError(null)
        const response = await fetch('/api/auth/oauth2/consent', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ accept, oauth_query: oauthQuery })
        })
        if (!response.ok) {
            setError('Could not complete authorization, please try again.')
            return
        }
        const { url } = (await response.json()) as { url: string }
        window.location.href = url
    }

    return (
        <div className="p-2">
            <h3>{clientName} wants to sign you in</h3>
            <p>Requested access: {scope}</p>
            <button type="button" onClick={() => respond(true)}>
                Allow
            </button>
            <button type="button" onClick={() => respond(false)}>
                Deny
            </button>
            {error && <p style={{ color: 'red' }}>{error}</p>}
        </div>
    )
}
