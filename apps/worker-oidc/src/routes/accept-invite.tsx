import { createFileRoute } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'

export const Route = createFileRoute('/accept-invite')({
    component: AcceptInviteRoute
})

function AcceptInviteRoute() {
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
        const response = await fetch('/api/invites/accept', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ token, password })
        })
        if (!response.ok) {
            setError(await response.text().then(text => text || 'Could not accept this invite, please try again.'))
            return
        }
        setDone(true)
    }

    if (!token) {
        return (
            <div className="p-2">
                <h3>Accept invite</h3>
                <p style={{ color: 'red' }}>This invite link is missing its token.</p>
            </div>
        )
    }

    if (done) {
        return (
            <div className="p-2">
                <h3>You're all set</h3>
                <p>
                    Your password is set. <a href="/login">Sign in</a>.
                </p>
            </div>
        )
    }

    return (
        <div className="p-2">
            <h3>Accept your invite</h3>
            <form onSubmit={handleSubmit}>
                <label>
                    Password <input type="password" name="password" required />
                </label>
                <label>
                    Confirm password <input type="password" name="confirm" required />
                </label>
                <button type="submit">Set password</button>
            </form>
            {error && <p style={{ color: 'red' }}>{error}</p>}
        </div>
    )
}
