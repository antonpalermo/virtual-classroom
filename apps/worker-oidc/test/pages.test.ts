import { describe, it } from 'vitest'
import { callAsApp } from './helpers/call-app'

describe('GET /login', () => {
    it('renders a sign-in form and preserves the query string in the resume link', async ({ expect }) => {
        const response = await callAsApp(new Request('https://example.com/login?client_id=abc&state=xyz'))
        expect(response.status).toBe(200)
        const html = await response.text()
        expect(html).toContain('name="email"')
        expect(html).toContain('name="password"')
    })
})

describe('GET /signup', () => {
    it('renders a registration form', async ({ expect }) => {
        const response = await callAsApp(new Request('https://example.com/signup?client_id=abc&state=xyz'))
        expect(response.status).toBe(200)
        const html = await response.text()
        expect(html).toContain('name="name"')
        expect(html).toContain('name="email"')
        expect(html).toContain('name="password"')
    })
})

describe('GET /consent', () => {
    it('escapes an unrecognized client_id rather than reflecting it unescaped', async ({ expect }) => {
        const response = await callAsApp(
            new Request(`https://example.com/consent?${new URLSearchParams({ client_id: '<script>alert(1)</script>', scope: 'openid' })}`)
        )
        expect(response.status).toBe(200)
        const html = await response.text()
        expect(html).not.toContain('<script>alert(1)</script>')
    })
})
