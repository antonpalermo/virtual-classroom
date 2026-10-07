import { Button } from '@capstone/ui/components/button'
import { useState } from 'react'
import { buildAuthorizeResumeQuery } from './lib/resume-authorize-query'

// Better Auth redirects back to errorCallbackURL with ?error=<code> when the Google leg fails.
function callbackError() {
    const code = new URLSearchParams(window.location.search).get('error')
    // not_authorized isn't Google-specific — worker/restrict-worker-admin-client.ts sends it here
    // for either sign-in method, and login.tsx owns showing it (see loginError() there).
    if (!code || code === 'not_authorized') return null
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
                    // Resumes /api/auth/oauth2/authorize once Google succeeds — prompt=login is
                    // already satisfied at that point, so it's stripped here (see
                    // resume-authorize-query.ts) to avoid looping back to /login forever.
                    callbackURL: `/api/auth/oauth2/authorize?${buildAuthorizeResumeQuery(flowQuery)}`,
                    // Re-lands on /login after a failed Google attempt — prompt is deliberately
                    // kept here (via flowQuery, not the stripped version) so a retry still forces
                    // fresh authentication.
                    errorCallbackURL: `${window.location.pathname}?${flowQuery}`,
                    // Sent as a signed blob Better Auth verifies byte-for-byte against its own
                    // signature — must stay exactly flowQuery, never the prompt-stripped version,
                    // or the call fails with invalid_signature (confirmed live).
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
            <Button type="button" variant="outline" onClick={handleClick} disabled={busy}>
                Continue with Google
            </Button>
            {error && <p className="text-sm text-destructive">{error}</p>}
        </>
    )
}
