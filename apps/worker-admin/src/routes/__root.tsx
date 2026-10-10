import { type AccessTokenClaims, verifyAccessToken } from '@capstone/auth-verify'
import { createRootRoute, Outlet } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { clearStoredJwt, getStoredJwt, redirectToSignIn } from '../lib/auth-client'

const OIDC_ORIGIN = import.meta.env.VITE_OIDC_ORIGIN ?? 'http://localhost:8791'
const JWKS_URL = `${OIDC_ORIGIN}/api/auth/jwks`

const RootLayout = () => (
    <>
        <Outlet />
        <TanStackRouterDevtools />
    </>
)

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
