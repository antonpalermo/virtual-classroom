import { createFileRoute } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'

export const Route = createFileRoute('/forgot-password')({
    component: ForgotPasswordRoute
})

function ForgotPasswordRoute() {
    const [error, setError] = useState<string | null>(null)
    const [done, setDone] = useState(false)

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        setError(null)
        const form = new FormData(event.currentTarget)
        try {
            await fetch('/api/auth/request-password-reset', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ email: form.get('email'), redirectTo: '/reset-password' })
            })
            // Shown regardless of the response status/body — Better Auth deliberately responds
            // the same way whether or not the email matches an account, so branching on the
            // result here would defeat that anti-enumeration behavior.
            setDone(true)
        } catch {
            setError('Something went wrong, please try again.')
        }
    }

    if (done) {
        return (
            <div className="p-2">
                <h3>Check your email</h3>
                <p>If an account exists for that email, we've sent a link to reset your password.</p>
            </div>
        )
    }

    return (
        <div className="p-2">
            <h3>Forgot your password?</h3>
            <form onSubmit={handleSubmit}>
                <label>
                    Email <input type="email" name="email" required />
                </label>
                <button type="submit">Send reset link</button>
            </form>
            {error && <p style={{ color: 'red' }}>{error}</p>}
            <p>
                <a href="/login">Back to sign in</a>
            </p>
        </div>
    )
}
