export default {
    fetch(request, env) {
        const url = new URL(request.url)

        if (url.pathname.startsWith('/api/auth/')) {
            return env.AUTH_SERVICE.fetch(request)
        }

        return new Response(null, { status: 404 })
    }
} satisfies ExportedHandler<Env>
