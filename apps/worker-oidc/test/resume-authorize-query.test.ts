import { describe, it } from 'vitest'
import { buildAuthorizeResumeQuery } from '../src/lib/resume-authorize-query.js'

describe('buildAuthorizeResumeQuery', () => {
    it('strips prompt=login so resuming /api/auth/oauth2/authorize after a fresh sign-in does not force /login again', async ({
        expect
    }) => {
        const query = buildAuthorizeResumeQuery('client_id=abc&prompt=login&state=xyz')

        expect(new URLSearchParams(query).has('prompt')).toBe(false)
    })

    it('strips a stale error param left over from a prior failed attempt', async ({ expect }) => {
        const query = buildAuthorizeResumeQuery('client_id=abc&error=not_authorized&error_description=nope')

        expect(new URLSearchParams(query).has('error')).toBe(false)
        expect(new URLSearchParams(query).has('error_description')).toBe(false)
    })

    it('leaves every other parameter untouched', async ({ expect }) => {
        const query = buildAuthorizeResumeQuery('client_id=abc&state=xyz&redirect_uri=https%3A%2F%2Fx.test%2Fcb')

        const params = new URLSearchParams(query)
        expect(params.get('client_id')).toBe('abc')
        expect(params.get('state')).toBe('xyz')
        expect(params.get('redirect_uri')).toBe('https://x.test/cb')
    })
})
