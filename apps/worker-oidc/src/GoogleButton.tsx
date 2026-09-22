import { useState } from 'react'

// Better Auth redirects back to errorCallbackURL with ?error=<code> when the Google leg fails.
function callbackError() {
    const code = new URLSearchParams(window.location.search).get('error')
    if (!code) return null
    if (code === 'account_not_linked') return 'An account with this email already exists. Sign in with your password instead.'
    if (code === 'signup_disabled') return 'No account found for this Google account. Ask an administrator for access.'
    return 'Google sign-in failed, please try again.'
}

export function GoogleButton({ oauthQuery }: { oauthQuery: string }) {
    const [error, setError] = useState<string | null>(callbackError)
    const [busy, setBusy] = useState(false)

    async function handleClick() {
        setError(null)
        setBusy(true)
        try {
            const params = new URLSearchParams(oauthQuery)
            params.delete('error')
            params.delete('error_description')
            const flowQuery = params.toString()
            const response = await fetch('/api/auth/sign-in/social', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    provider: 'google',
                    callbackURL: `/api/auth/oauth2/authorize?${flowQuery}`,
                    errorCallbackURL: `${window.location.pathname}?${flowQuery}`,
                    oauth_query: flowQuery
                })
            })
            if (!response.ok) throw new Error(`sign-in/social ${response.status}`)
            const { url } = (await response.json()) as { url: string }
            window.location.href = url
        } catch {
            setError('Google sign-in is unavailable, please try again.')
            setBusy(false)
        }
    }

    return (
        <>
            <button type="button" onClick={handleClick} disabled={busy}>
                Continue with Google
            </button>
            {error && <p style={{ color: 'red' }}>{error}</p>}
        </>
    )
}
