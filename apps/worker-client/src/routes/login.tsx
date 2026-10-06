import { Button } from '@capstone/ui/components/button'
import { Card, CardContent, CardFooter } from '@capstone/ui/components/card'
import { createFileRoute } from '@tanstack/react-router'
import { createPkcePair } from '../lib/pkce'

const OIDC_ORIGIN = import.meta.env.VITE_OIDC_ORIGIN ?? 'http://localhost:8791'
const CLIENT_ID = import.meta.env.VITE_OIDC_CLIENT_ID ?? ''

export const Route = createFileRoute('/login')({
    component: LoginRoute
})

function LoginRoute() {
    async function signIn() {
        const { codeVerifier, codeChallenge } = await createPkcePair()
        const state = crypto.randomUUID()
        sessionStorage.setItem('oidc_code_verifier', codeVerifier)
        sessionStorage.setItem('oidc_state', state)

        const params = new URLSearchParams({
            client_id: CLIENT_ID,
            redirect_uri: `${window.location.origin}/auth-callback`,
            response_type: 'code',
            scope: 'openid email profile',
            code_challenge: codeChallenge,
            code_challenge_method: 'S256',
            state,
            // Signing out only clears the stored token (src/routes/index.tsx's signOut), so a
            // still-live worker-oidc session cookie — e.g. from a worker-admin sign-in on the same
            // browser — would otherwise be silently reused. Same fix as worker-admin's login.tsx.
            prompt: 'login'
        })
        window.location.href = `${OIDC_ORIGIN}/api/auth/oauth2/authorize?${params.toString()}`
    }

    return (
        <div className="flex min-h-svh flex-col items-center justify-center bg-muted p-6 md:p-10">
            <Card className="w-full max-w-sm overflow-hidden md:max-w-3xl">
                <CardContent className="grid gap-6 p-8 md:grid-cols-2">
                    <div className="flex flex-col justify-center gap-6">
                        <div className="flex flex-col gap-2">
                            <h1 className="text-3xl font-bold tracking-tight">Welcome back</h1>
                            <p className="text-sm text-muted-foreground">Sign in to continue to your virtual classroom</p>
                        </div>
                        <Button type="button" onClick={signIn} size="lg">
                            Sign in
                        </Button>
                    </div>
                    <div className="hidden bg-gradient-to-b from-muted to-muted/50 md:block" />
                </CardContent>
                <CardFooter className="border-t px-8 py-6">
                    <p className="text-xs text-muted-foreground">
                        By clicking continue, you agree to our Terms of Service and Privacy Policy
                    </p>
                </CardFooter>
            </Card>
        </div>
    )
}
