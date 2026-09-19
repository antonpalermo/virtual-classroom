import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import app from '../../worker/index.js'

export async function callAsApp(request: Request, envOverrides: Partial<typeof env> = {}) {
    const ctx = createExecutionContext()
    const response = await app.fetch(request, { ...env, ...envOverrides }, ctx)
    await waitOnExecutionContext(ctx)
    return response
}
