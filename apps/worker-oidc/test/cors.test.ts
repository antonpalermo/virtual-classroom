import { describe, expect, it } from 'vitest'
import { callAsApp } from './helpers/call-app'

describe('CORS on cross-origin browser endpoints', () => {
    it.each(['/api/auth/jwks', '/api/auth/oauth2/userinfo'])('opens CORS on %s', async path => {
        const response = await callAsApp(new Request(`https://example.com${path}`, { headers: { origin: 'https://admin.example.test' } }))
        expect(response.headers.get('access-control-allow-origin')).toBe('*')
    })

    it('opens CORS on /api/auth/oauth2/token', async () => {
        const response = await callAsApp(
            new Request('https://example.com/api/auth/oauth2/token', {
                method: 'POST',
                headers: { origin: 'https://admin.example.test', 'content-type': 'application/x-www-form-urlencoded' },
                body: 'grant_type=authorization_code'
            })
        )
        expect(response.headers.get('access-control-allow-origin')).toBe('*')
    })
})
