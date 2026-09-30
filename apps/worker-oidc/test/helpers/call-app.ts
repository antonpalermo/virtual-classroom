import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import app from '../../worker/index.js'

// Rate limiting keys on IP + path. None of this suite's ~10 test files set a client-IP header on
// their synthetic requests, so without this, every one of them would resolve to Better Auth's own
// shared "no-trusted-ip" fallback bucket and trip each other's limits. Assigning each call its own
// random IP (unless the caller already set one) keeps every existing test file working unchanged;
// only test/rate-limit.test.ts deliberately sets a fixed, shared IP across several calls to force
// and verify a collision.
function randomSyntheticIp() {
    return Array.from({ length: 4 }, () => Math.floor(Math.random() * 256)).join('.')
}

export async function callAsApp(request: Request, envOverrides: Partial<typeof env> = {}) {
    const headers = new Headers(request.headers)
    if (!headers.has('cf-connecting-ip')) headers.set('cf-connecting-ip', randomSyntheticIp())
    const withIp = new Request(request, { headers })

    const ctx = createExecutionContext()
    const response = await app.fetch(withIp, { ...env, ...envOverrides }, ctx)
    await waitOnExecutionContext(ctx)
    return response
}
