import { createLocalJWKSet, createRemoteJWKSet, type JSONWebKeySet, type JWTVerifyGetKey, jwtVerify } from 'jose'

export interface AccessTokenClaims {
    sub: string
    email: string
    role?: string
    exp: number
}

async function verifyWithKeySet(token: string, keySet: JWTVerifyGetKey): Promise<AccessTokenClaims | null> {
    try {
        const { payload } = await jwtVerify(token, keySet, {
            requiredClaims: ['exp', 'sub', 'email']
        })
        if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') {
            return null
        }
        if (payload.role !== undefined && typeof payload.role !== 'string') {
            return null
        }
        return { sub: payload.sub, email: payload.email, role: payload.role as string | undefined, exp: payload.exp as number }
    } catch {
        return null
    }
}

// createRemoteJWKSet does its own internal caching of the fetched key set, but only if the same
// instance is reused across calls — a fresh instance per call would re-fetch every time.
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

function getJwks(jwksUrl: string) {
    let jwks = jwksCache.get(jwksUrl)
    if (!jwks) {
        // cooldownDuration: 0 — jose defaults to a 30s cooldown between fetches, so an unfamiliar
        // kid (e.g. right after the issuer rotates its signing key) would otherwise fail
        // verification for up to 30s after the last successful fetch instead of refetching
        // immediately. No real downside for our use: this JWKS endpoint is cheap and CORS-open.
        jwks = createRemoteJWKSet(new URL(jwksUrl), { cooldownDuration: 0 })
        jwksCache.set(jwksUrl, jwks)
    }
    return jwks
}

// For a browser caller (worker-client, worker-admin) checking a stored id_token locally against
// worker-oidc's public JWKS endpoint.
export async function verifyAccessToken(token: string, jwksUrl: string): Promise<AccessTokenClaims | null> {
    return verifyWithKeySet(token, getJwks(jwksUrl))
}

// For a server that already holds its own signing keys in-process (worker-oidc verifying a token
// it issued itself, e.g. its admin API) — skips the network round trip verifyAccessToken needs
// for a remote JWKS URL, using the same claim validation either way.
export async function verifyAccessTokenWithJwks(token: string, jwks: JSONWebKeySet): Promise<AccessTokenClaims | null> {
    return verifyWithKeySet(token, createLocalJWKSet(jwks))
}
