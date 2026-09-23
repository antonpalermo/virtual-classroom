import { describe, expect, it } from 'vitest'
import { createPkcePair } from '../src/lib/pkce'

describe('createPkcePair', () => {
    it('generates a URL-safe code_verifier and its S256 code_challenge', async () => {
        const { codeVerifier, codeChallenge } = await createPkcePair()

        expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]{40,}$/)
        expect(codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/)

        const expectedDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier))
        const expectedChallenge = btoa(String.fromCharCode(...new Uint8Array(expectedDigest)))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '')
        expect(codeChallenge).toBe(expectedChallenge)
    })

    it('generates a different pair on every call', async () => {
        const first = await createPkcePair()
        const second = await createPkcePair()
        expect(first.codeVerifier).not.toBe(second.codeVerifier)
    })
})
