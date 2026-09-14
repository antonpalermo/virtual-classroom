import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
    plugins: [
        cloudflareTest({
            wrangler: { configPath: './wrangler.jsonc' },
            miniflare: {
                serviceBindings: {
                    AUTH_SERVICE(request) {
                        const url = new URL(request.url)
                        if (url.pathname === '/api/auth/callback/google' && url.searchParams.get('code') === 'test') {
                            return new Response(null, {
                                status: 302,
                                headers: {
                                    location: 'https://example.com/login?returnTo=http%3A%2F%2Flocalhost%3A8790%2Fauth-callback',
                                    'set-auth-token': 'test-token'
                                }
                            })
                        }
                        if (url.pathname === '/api/auth/callback/google') {
                            return new Response(null, {
                                status: 302,
                                headers: { location: 'https://example.com/', 'set-auth-token': 'test-token' }
                            })
                        }
                        if (url.pathname === '/api/auth/some-other-redirect') {
                            return new Response(null, {
                                status: 302,
                                headers: { location: 'https://example.com/elsewhere', 'set-auth-token': 'test-token' }
                            })
                        }
                        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
                    }
                }
            }
        })
    ]
})
