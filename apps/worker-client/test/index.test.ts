import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { it } from 'vitest'
import app from '../worker/index'

it('forwards /api/auth/* requests to the AUTH_SERVICE binding', async ({ expect }) => {
    const ctx = createExecutionContext()
    const response = await app.fetch(
        new Request('https://example.com/api/auth/get-session', { headers: { authorization: 'Bearer test-token' } }),
        env,
        ctx
    )
    await waitOnExecutionContext(ctx)

    expect(response.status).toBe(200)
    const body = await response.json<{ url: string; authorization: string | null }>()
    expect(body.url).toBe('https://example.com/api/auth/get-session')
    expect(body.authorization).toBe('Bearer test-token')
})

it('404s any request outside /api/auth/*', async ({ expect }) => {
    const ctx = createExecutionContext()
    const response = await app.fetch(new Request('https://example.com/api/admin/whatever'), env, ctx)
    await waitOnExecutionContext(ctx)

    expect(response.status).toBe(404)
})
