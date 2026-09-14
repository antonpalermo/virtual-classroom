import { createFileRoute } from '@tanstack/react-router'

// worker-client's dev origin — the one place the sign-in round-trip starts (see
// docs/superpowers/specs/2026-09-14-admin-user-roles-dashboard-design.md).
const CLIENT_ORIGIN = 'http://localhost:5173'

export const Route = createFileRoute('/login')({
    component: LoginRoute
})

function LoginRoute() {
    const returnTo = `${window.location.origin}/auth-callback`
    const signInUrl = `${CLIENT_ORIGIN}/login?returnTo=${encodeURIComponent(returnTo)}`

    return (
        <div className="p-2">
            <h3>Sign in</h3>
            <a href={signInUrl}>Sign in with Google</a>
        </div>
    )
}
