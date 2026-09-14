import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { it } from 'vitest'
import app from '../worker/index'

it('appends the bearer token as a fragment when the callback redirect carries a returnTo param', async ({ expect }) => {
    const ctx = createExecutionContext()
    const response = await app.fetch(new Request('https://example.com/api/auth/callback/google?code=test&state=test'), env, ctx)
    await waitOnExecutionContext(ctx)

    expect(response.headers.get('location')).toBe(
        'https://example.com/login?returnTo=http%3A%2F%2Flocalhost%3A8790%2Fauth-callback#token=test-token'
    )
})

it('leaves the callback redirect untouched when there is no returnTo param', async ({ expect }) => {
    const ctx = createExecutionContext()
    const response = await app.fetch(new Request('https://example.com/api/auth/callback/google?code=plain&state=plain'), env, ctx)
    await waitOnExecutionContext(ctx)

    expect(response.headers.get('location')).toBe('https://example.com/')
})

it('relays a non-callback redirect byte-for-byte, without rewriting it', async ({ expect }) => {
    const ctx = createExecutionContext()
    const response = await app.fetch(new Request('https://example.com/api/auth/some-other-redirect'), env, ctx)
    await waitOnExecutionContext(ctx)

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://example.com/elsewhere')
})

it('forwards other /api/auth/* requests untouched', async ({ expect }) => {
    const ctx = createExecutionContext()
    const response = await app.fetch(new Request('https://example.com/api/auth/get-session'), env, ctx)
    await waitOnExecutionContext(ctx)

    expect(response.status).toBe(200)
})

it('404s any request outside /api/auth/*', async ({ expect }) => {
    const ctx = createExecutionContext()
    const response = await app.fetch(new Request('https://example.com/whatever'), env, ctx)
    await waitOnExecutionContext(ctx)

    expect(response.status).toBe(404)
})
