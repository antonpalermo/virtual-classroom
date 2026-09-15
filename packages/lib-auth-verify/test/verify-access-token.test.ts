import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { verifyAccessToken } from '../src/verify-access-token'

const JWKS_URL = 'https://auth.example.test/api/auth/jwks'

let privateKey: CryptoKey
let publicJwk: Record<string, unknown>

beforeAll(async () => {
    const { privateKey: priv, publicKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' })
    privateKey = priv
    publicJwk = { ...(await exportJWK(publicKey)), alg: 'EdDSA', use: 'sig', kid: 'test-key' }

    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string | URL) => {
            if (input.toString() === JWKS_URL) {
                return new Response(JSON.stringify({ keys: [publicJwk] }), {
                    headers: { 'content-type': 'application/json' }
                })
            }
            throw new Error(`unexpected fetch: ${input}`)
        })
    )
})

async function signToken(claims: Record<string, unknown>, expiresIn = '15m') {
    return new SignJWT(claims)
        .setProtectedHeader({ alg: 'EdDSA', kid: 'test-key' })
        .setIssuedAt()
        .setExpirationTime(expiresIn)
        .sign(privateKey)
}

describe('verifyAccessToken', () => {
    it('returns claims for a valid token', async () => {
        const token = await signToken({ sub: 'user-1', email: 'a@example.com', role: 'admin' })
        const result = await verifyAccessToken(token, JWKS_URL)
        expect(result).toMatchObject({ sub: 'user-1', email: 'a@example.com', role: 'admin' })
    })

    it('returns null for an expired token', async () => {
        const token = await signToken({ sub: 'user-1', email: 'a@example.com', role: 'admin' }, '-10s')
        const result = await verifyAccessToken(token, JWKS_URL)
        expect(result).toBeNull()
    })

    it('returns null for a bad signature', async () => {
        const { privateKey: otherKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' })
        const token = await new SignJWT({ sub: 'user-1', email: 'a@example.com', role: 'admin' })
            .setProtectedHeader({ alg: 'EdDSA', kid: 'test-key' })
            .setIssuedAt()
            .setExpirationTime('15m')
            .sign(otherKey)
        const result = await verifyAccessToken(token, JWKS_URL)
        expect(result).toBeNull()
    })

    it('returns null for a malformed token', async () => {
        const result = await verifyAccessToken('not-a-jwt', JWKS_URL)
        expect(result).toBeNull()
    })

    it('returns null when the role claim is missing', async () => {
        const token = await signToken({ sub: 'user-1', email: 'a@example.com' })
        const result = await verifyAccessToken(token, JWKS_URL)
        expect(result).toBeNull()
    })
})
