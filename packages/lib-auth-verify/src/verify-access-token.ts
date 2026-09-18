import { createRemoteJWKSet, jwtVerify } from 'jose'

export interface AccessTokenClaims {
    sub: string
    email: string
    role?: string
    exp: number
}

// createRemoteJWKSet does its own internal caching of the fetched key set, but only if the same
// instance is reused across calls — a fresh instance per call would re-fetch every time.
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

function getJwks(jwksUrl: string) {
    let jwks = jwksCache.get(jwksUrl)
    if (!jwks) {
        jwks = createRemoteJWKSet(new URL(jwksUrl))
        jwksCache.set(jwksUrl, jwks)
    }
    return jwks
}

export async function verifyAccessToken(token: string, jwksUrl: string): Promise<AccessTokenClaims | null> {
    try {
        const { payload } = await jwtVerify(token, getJwks(jwksUrl), {
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
