import { type AccessTokenClaims, verifyAccessToken } from '@capstone/auth-verify'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@capstone/ui/components/sidebar'
import { createRootRoute, Outlet } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { AppSidebar } from '../components/app-sidebar'
import { UserMenu } from '../components/user-menu'
import { clearStoredJwt, getStoredJwt, redirectToSignIn } from '../lib/auth-client'

const OIDC_ORIGIN = import.meta.env.VITE_OIDC_ORIGIN ?? 'http://localhost:8791'
const JWKS_URL = `${OIDC_ORIGIN}/api/auth/jwks`

function RootLayout() {
    const { claims } = Route.useRouteContext()

    // No claims only on /auth-callback (the guard below skips it): render it bare, without the app chrome.
    if (!claims) return <Outlet />

    return (
        <SidebarProvider>
            <AppSidebar />
            {/* The inset itself stays transparent so the header sits on the sidebar background, outside
                the rounded content panel below it. */}
            <SidebarInset className="bg-transparent md:peer-data-[variant=inset]:rounded-none md:peer-data-[variant=inset]:shadow-none">
                <header className="flex h-12 mb-2 shrink-0 items-center justify-between">
                    <SidebarTrigger />
                    <UserMenu email={claims.email} />
                </header>
                <div className="m-2 mt-0 min-w-0 flex-1 overflow-x-auto rounded-xl bg-background p-4 shadow-sm ring-1 ring-sidebar-border md:m-0">
                    <Outlet />
                </div>
            </SidebarInset>
            <TanStackRouterDevtools />
        </SidebarProvider>
    )
}

export const Route = createRootRoute({
    // Every route but /auth-callback needs a signed-in user: a missing or no-longer-verifying
    // token sends the browser to worker-oidc's sign-in page.
    beforeLoad: async ({ location }): Promise<{ claims?: AccessTokenClaims }> => {
        if (location.pathname === '/auth-callback') return {}
        const token = getStoredJwt()
        const claims = token ? await verifyAccessToken(token, JWKS_URL) : null
        if (claims) return { claims }
        clearStoredJwt()
        await redirectToSignIn()
        // Never resolves: the page is already navigating away, so don't render anything meanwhile.
        return new Promise(() => {})
    },
    component: RootLayout
})
