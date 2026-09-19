import { describe, expect, it } from 'vitest'
import { callAsApp } from './helpers/call-app.js'

describe('Google sign-in', () => {
    it('returns a Google authorization URL pointing back at this worker', async () => {
        const response = await callAsApp(
            new Request('https://example.com/api/auth/sign-in/social', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ provider: 'google', callbackURL: '/api/auth/oauth2/authorize?client_id=x' })
            }),
            { BETTER_AUTH_URL: 'https://example.com', GOOGLE_CLIENT_ID: 'test-client-id', GOOGLE_CLIENT_SECRET: 'test-client-secret' }
        )
        expect(response.status).toBe(200)
        const { url } = (await response.json()) as { url: string }
        const google = new URL(url)
        expect(google.origin).toBe('https://accounts.google.com')
        expect(google.searchParams.get('client_id')).toBe('test-client-id')
        expect(google.searchParams.get('redirect_uri')).toBe('https://example.com/api/auth/callback/google')
    })
})
