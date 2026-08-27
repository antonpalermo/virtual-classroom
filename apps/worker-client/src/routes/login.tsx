import { createFileRoute } from '@tanstack/react-router'
import { authClient } from '../lib/auth-client'

export const Route = createFileRoute('/login')({
    component: LoginRoute
})

function LoginRoute() {
    return (
        <div className="p-2">
            <h3>Sign in</h3>
            <button type="button" onClick={() => authClient.signIn.social({ provider: 'google', callbackURL: '/' })}>
                Sign in with Google
            </button>
        </div>
    )
}
