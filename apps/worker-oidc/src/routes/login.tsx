import { Button } from '@capstone/ui/components/button'
import { FieldGroup } from '@capstone/ui/components/field'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { GoogleButton } from '../GoogleButton'
import { useAppForm } from '../lib/form'
import { buildAuthorizeResumeQuery } from '../lib/resume-authorize-query'
import { all, email, required } from '../lib/validators'

export const Route = createFileRoute('/login')({
    component: LoginRoute
})

// worker/restrict-worker-admin-client.ts sends this back here for either sign-in method when a
// signed-in non-admin tries to complete worker-admin's OAuth flow.
function loginError() {
    const code = new URLSearchParams(window.location.search).get('error')
    return code === 'not_authorized' ? "This account isn't authorized to sign in here." : null
}

const validateEmail = all(required('Email is required'), email())
const validatePassword = required('Password is required')

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

    async function handleSubmit(values: { email: string; password: string }) {
        setError(null)
        const response = await fetch('/api/auth/sign-in/email', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(values)
        })
        if (!response.ok) {
            // 429 = rate-limited (possibly a whole lab sharing one IP), not a wrong password.
            setError(
                response.status === 429
                    ? 'Too many attempts from your network. Please wait a minute and try again.'
                    : 'Sign-in failed, please try again.'
            )
            return
        }
        // Strips prompt=login/create (already satisfied by this sign-in — see
        // resume-authorize-query.ts for why leaving it in would loop back to /login forever) and
        // a stale ?error= (e.g. from a prior not_authorized bounce) before resuming.
        window.location.href = `/api/auth/oauth2/authorize?${buildAuthorizeResumeQuery(oauthQuery)}`
    }

    const form = useAppForm({
        defaultValues: { email: '', password: '' },
        onSubmit: ({ value }) => handleSubmit(value)
    })

    return (
        <div className="dark grid min-h-svh bg-background text-foreground lg:grid-cols-2">
            <div className="flex flex-col p-8">
                <span className="font-medium">Virtual Classroom</span>
                <form
                    noValidate
                    onSubmit={event => {
                        event.preventDefault()
                        form.handleSubmit()
                    }}
                    className="m-auto flex w-full max-w-xs flex-col gap-4"
                >
                    <div className="text-center">
                        <h1 className="text-2xl font-bold">Sign in{clientName ? ` to continue to ${clientName}` : ''}</h1>
                        <p className="text-sm text-muted-foreground">Enter your email below to sign in to your account</p>
                    </div>
                    <FieldGroup>
                        <form.AppField name="email" validators={{ onBlur: validateEmail, onSubmit: validateEmail }}>
                            {field => <field.TextField label="Email" type="email" placeholder="jane.doe@example.com" />}
                        </form.AppField>
                        <form.AppField name="password" validators={{ onBlur: validatePassword, onSubmit: validatePassword }}>
                            {field => (
                                <field.TextField
                                    label="Password"
                                    type="password"
                                    placeholder="Password"
                                    aside={
                                        <a href="/forgot-password" className="text-sm hover:underline">
                                            Forgot your password?
                                        </a>
                                    }
                                />
                            )}
                        </form.AppField>
                    </FieldGroup>
                    {error && <p className="text-sm text-destructive">{error}</p>}
                    <Button type="submit">Sign in</Button>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <hr className="flex-1 border-border" />
                        Or continue with
                        <hr className="flex-1 border-border" />
                    </div>
                    <GoogleButton oauthQuery={oauthQuery} />
                </form>
            </div>
            <div className="hidden bg-muted lg:block" />
        </div>
    )
}
