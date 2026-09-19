import { useState } from 'react'

export function GoogleButton({ oauthQuery }: { oauthQuery: string }) {
    const [error, setError] = useState<string | null>(null)

    async function handleClick() {
        setError(null)
        const response = await fetch('/api/auth/sign-in/social', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ provider: 'google', callbackURL: `/api/auth/oauth2/authorize?${oauthQuery}` })
        })
        if (!response.ok) {
            setError('Google sign-in is unavailable, please try again.')
            return
        }
        const { url } = (await response.json()) as { url: string }
        window.location.href = url
    }

    return (
        <>
            <button type="button" onClick={handleClick}>
                Continue with Google
            </button>
            {error && <p style={{ color: 'red' }}>{error}</p>}
        </>
    )
}
