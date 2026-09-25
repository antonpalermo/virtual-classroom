import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { verifyAccessToken, verifyAccessTokenWithJwks } from '../src/verify-access-token'

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

async function signTokenWithoutExp(claims: Record<string, unknown>) {
    return new SignJWT(claims).setProtectedHeader({ alg: 'EdDSA', kid: 'test-key' }).setIssuedAt().sign(privateKey)
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

    it('returns claims with role undefined when the role claim is missing', async () => {
        const token = await signToken({ sub: 'user-1', email: 'a@example.com' })
        const result = await verifyAccessToken(token, JWKS_URL)
        expect(result).toMatchObject({ sub: 'user-1', email: 'a@example.com' })
        expect(result?.role).toBeUndefined()
    })

    it('returns null when the exp claim is missing', async () => {
        const token = await signTokenWithoutExp({ sub: 'user-1', email: 'a@example.com', role: 'admin' })
        const result = await verifyAccessToken(token, JWKS_URL)
        expect(result).toBeNull()
    })

    // Regression: a server-side caller that verifies tokens signed by many different, short-lived
    // signing keys under the same JWKS URL in quick succession (e.g. a test suite that gets a
    // fresh signing key per test run, all fetched from the same worker's /api/auth/jwks) must not
    // get stuck verifying against a stale cached key set. jose's createRemoteJWKSet defaults to a
    // 30s cooldown between fetches — without disabling it, a kid it hasn't seen yet would
    // incorrectly fail verification for up to 30s after the previous fetch.
    it('refetches immediately when it sees an unfamiliar kid, even right after a previous fetch', async () => {
        const rotatingUrl = 'https://rotates.example.test/api/auth/jwks'
        const keyA = await generateKeyPair('EdDSA', { crv: 'Ed25519' })
        const keyB = await generateKeyPair('EdDSA', { crv: 'Ed25519' })
        const jwkA = { ...(await exportJWK(keyA.publicKey)), alg: 'EdDSA', use: 'sig', kid: 'key-a' }
        const jwkB = { ...(await exportJWK(keyB.publicKey)), alg: 'EdDSA', use: 'sig', kid: 'key-b' }

        let currentJwks = jwkA
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: string | URL) => {
                if (input.toString() === rotatingUrl) {
                    return new Response(JSON.stringify({ keys: [currentJwks] }), { headers: { 'content-type': 'application/json' } })
                }
                throw new Error(`unexpected fetch: ${input}`)
            })
        )

        const tokenA = await new SignJWT({ sub: 'user-1', email: 'a@example.com' })
            .setProtectedHeader({ alg: 'EdDSA', kid: 'key-a' })
            .setIssuedAt()
            .setExpirationTime('15m')
            .sign(keyA.privateKey)
        expect(await verifyAccessToken(tokenA, rotatingUrl)).toMatchObject({ sub: 'user-1' })

        // Simulate the JWKS endpoint now serving a different key (a fresh signing key, same URL)
        // and verify a token signed with it immediately — no delay, well inside jose's cooldown.
        currentJwks = jwkB
        const tokenB = await new SignJWT({ sub: 'user-2', email: 'b@example.com' })
            .setProtectedHeader({ alg: 'EdDSA', kid: 'key-b' })
            .setIssuedAt()
            .setExpirationTime('15m')
            .sign(keyB.privateKey)
        expect(await verifyAccessToken(tokenB, rotatingUrl)).toMatchObject({ sub: 'user-2' })
    })
})

describe('verifyAccessTokenWithJwks', () => {
    // For a server verifying a token it issued itself (worker-oidc's own admin API): it already
    // holds its own JWKS in-process (via Better Auth's own handler, no network hop needed), so
    // this skips the remote-fetch path verifyAccessToken uses for browser callers entirely.
    it('returns claims for a token verified against a locally-held key set', async () => {
        const { privateKey, publicKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' })
        const jwk = { ...(await exportJWK(publicKey)), alg: 'EdDSA', use: 'sig', kid: 'local-key' }
        const token = await new SignJWT({ sub: 'user-1', email: 'a@example.com', role: 'admin' })
            .setProtectedHeader({ alg: 'EdDSA', kid: 'local-key' })
            .setIssuedAt()
            .setExpirationTime('15m')
            .sign(privateKey)

        const result = await verifyAccessTokenWithJwks(token, { keys: [jwk] })
        expect(result).toMatchObject({ sub: 'user-1', email: 'a@example.com', role: 'admin' })
    })

    it('returns null when no key in the set matches', async () => {
        const { privateKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' })
        const { publicKey: otherPublicKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' })
        const wrongJwk = { ...(await exportJWK(otherPublicKey)), alg: 'EdDSA', use: 'sig', kid: 'local-key' }
        const token = await new SignJWT({ sub: 'user-1', email: 'a@example.com' })
            .setProtectedHeader({ alg: 'EdDSA', kid: 'local-key' })
            .setIssuedAt()
            .setExpirationTime('15m')
            .sign(privateKey)

        const result = await verifyAccessTokenWithJwks(token, { keys: [wrongJwk] })
        expect(result).toBeNull()
    })
})
