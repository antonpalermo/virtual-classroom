import { createFileRoute } from '@tanstack/react-router'

// worker-auth's own hosted login page — this app no longer routes through worker-client at all.
const AUTH_ORIGIN = import.meta.env.VITE_AUTH_ORIGIN ?? 'http://localhost:8789'

export const Route = createFileRoute('/login')({
    component: LoginRoute
})

function LoginRoute() {
    const returnTo = `${window.location.origin}/auth-callback`
    const signInUrl = `${AUTH_ORIGIN}/login?returnTo=${encodeURIComponent(returnTo)}`

    return (
        <div className="p-2">
            <h3>Sign in</h3>
            <a href={signInUrl}>Sign in with Google</a>
        </div>
    )
}
