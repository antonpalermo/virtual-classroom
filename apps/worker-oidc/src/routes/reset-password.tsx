import { createFileRoute } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'

export const Route = createFileRoute('/reset-password')({
    component: ResetPasswordRoute
})

function ResetPasswordRoute() {
    const token = new URLSearchParams(window.location.search).get('token') ?? ''
    const [error, setError] = useState<string | null>(null)
    const [done, setDone] = useState(false)

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        setError(null)
        const form = new FormData(event.currentTarget)
        const password = form.get('password')
        if (password !== form.get('confirm')) {
            setError('Passwords do not match.')
            return
        }
        const response = await fetch('/api/auth/reset-password', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ newPassword: password, token })
        })
        if (!response.ok) {
            setError(
                response.status === 429
                    ? 'Too many attempts from your network. Please wait a minute and try again.'
                    : 'Could not reset your password, please try again.'
            )
            return
        }
        setDone(true)
    }

    if (!token) {
        return (
            <div className="p-2">
                <h3>Reset your password</h3>
                <p style={{ color: 'red' }}>This reset link is missing its token.</p>
            </div>
        )
    }

    if (done) {
        return (
            <div className="p-2">
                <h3>Password reset</h3>
                <p>
                    Your password has been reset. <a href="/login">Sign in</a>.
                </p>
            </div>
        )
    }

    return (
        <div className="p-2">
            <h3>Reset your password</h3>
            <form onSubmit={handleSubmit}>
                <label>
                    New password <input type="password" name="password" required />
                </label>
                <label>
                    Confirm password <input type="password" name="confirm" required />
                </label>
                <button type="submit">Reset password</button>
            </form>
            {error && <p style={{ color: 'red' }}>{error}</p>}
        </div>
    )
}
