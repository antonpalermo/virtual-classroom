import { oauthProvider } from '@better-auth/oauth-provider'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { jwt } from 'better-auth/plugins'
import type { Db } from './db/client'

export function createAuth(db: Db, env: Env) {
    return betterAuth({
        baseURL: env.BETTER_AUTH_URL,
        secret: env.BETTER_AUTH_SECRET,
        database: drizzleAdapter(db, { provider: 'sqlite' }),
        emailAndPassword: {
            enabled: true
        },
        plugins: [
            // oauthProvider signs OIDC id_tokens via the jwt plugin — a hard
            // dependency (throws BetterAuthError("jwt_config") without it),
            // not an optional pairing.
            jwt(),
            oauthProvider({
                loginPage: '/login',
                consentPage: '/consent',
                signup: { page: '/signup' }
            })
        ]
    })
}
