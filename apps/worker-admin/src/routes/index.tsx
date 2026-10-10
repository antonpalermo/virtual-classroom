import { createFileRoute } from '@tanstack/react-router'
import { signOut } from '../lib/auth-client'

export const Route = createFileRoute('/')({
    component: DashboardRoute
})

function DashboardRoute() {
    const { claims } = Route.useRouteContext()

    return (
        <div>
            <p>Signed in as {claims?.email}</p>
            {claims?.role === 'admin' && (
                <p>
                    <a href="/users">Manage users</a>
                </p>
            )}
            <button type="button" onClick={signOut}>
                Sign out
            </button>
        </div>
    )
}
