import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { it } from 'vitest'
import app from '../src/index'

it('responds 200 on GET /', async ({ expect }) => {
    const ctx = createExecutionContext()
    const response = await app.fetch(new Request('https://example.com/'), env, ctx)
    await waitOnExecutionContext(ctx)

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('ok')
})
