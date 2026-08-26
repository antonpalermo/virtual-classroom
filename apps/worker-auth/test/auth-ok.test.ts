import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { it } from 'vitest'
import app from '../src/index'

it('GET /api/auth/ok returns status ok once Better Auth is mounted and migrated', async ({ expect }) => {
    const ctx = createExecutionContext()
    const response = await app.fetch(new Request('https://example.com/api/auth/ok'), env, ctx)
    await waitOnExecutionContext(ctx)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
})
