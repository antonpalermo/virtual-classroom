import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
    plugins: [
        cloudflareTest({
            wrangler: { configPath: './wrangler.jsonc' },
            miniflare: {
                // Overrides wrangler.jsonc's real `AUTH_SERVICE` binding (which points at the
                // separately deployed worker-auth) with a fake handler that echoes back the
                // request it received, so tests can assert the passthrough forwarded the right
                // URL/headers without needing worker-auth running.
                serviceBindings: {
                    AUTH_SERVICE(request) {
                        return new Response(
                            JSON.stringify({
                                url: request.url,
                                authorization: request.headers.get('authorization')
                            }),
                            { status: 200, headers: { 'content-type': 'application/json' } }
                        )
                    }
                }
            }
        })
    ]
})
