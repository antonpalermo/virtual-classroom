export default {
    async fetch(request, env) {
        const url = new URL(request.url)

        if (url.pathname.startsWith('/api/auth/')) {
            // redirect: 'manual' so a 3xx from worker-auth (e.g. the Google OAuth callback's
            // redirect, or the sign-in redirect to Google itself) passes through to the browser
            // as-is instead of being followed by this fetch call.
            const response = await env.AUTH_SERVICE.fetch(new Request(request, { redirect: 'manual' }))

            if (url.pathname === '/api/auth/callback/google') {
                const token = response.headers.get('set-auth-token')
                const location = response.headers.get('location')
                if (token && location) {
                    const redirectUrl = new URL(location, url.origin)
                    if (redirectUrl.searchParams.has('returnTo')) {
                        redirectUrl.hash = `token=${encodeURIComponent(token)}`
                        const headers = new Headers(response.headers)
                        headers.set('location', redirectUrl.toString())
                        return new Response(response.body, { status: response.status, headers })
                    }
                }
            }

            return response
        }

        return new Response(null, { status: 404 })
    }
} satisfies ExportedHandler<Env>
