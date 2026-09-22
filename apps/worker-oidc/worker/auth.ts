import { oauthProvider } from '@better-auth/oauth-provider'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { jwt } from 'better-auth/plugins'
import { eq } from 'drizzle-orm'
import type { Db } from './db/client.js'
import { oauthClient } from './db/schema.js'

export function createAuth(db: Db, env: Env) {
    return betterAuth({
        baseURL: env.BETTER_AUTH_URL,
        secret: env.BETTER_AUTH_SECRET,
        database: drizzleAdapter(db, { provider: 'sqlite' }),
        emailAndPassword: {
            enabled: true
        },
        hooks: {
            // worker-admin doesn't self-register accounts — admins are onboarded via
            // worker/bootstrap-admin-user.ts instead. Block only sign-ups whose oauth flow is
            // for the worker-admin client specifically (matched against the real registered
            // client_id, not a client-supplied name), so any other OAuth client added later
            // keeps normal self-service sign-up. src/routes/signup.tsx sends client_id in the
            // body for this to see.
            before: createAuthMiddleware(async ctx => {
                if (ctx.path !== '/sign-up/email') return
                const [workerAdmin] = await db.select().from(oauthClient).where(eq(oauthClient.name, 'worker-admin')).limit(1)
                if (workerAdmin && ctx.body?.client_id === workerAdmin.clientId) {
                    throw new APIError('FORBIDDEN', { message: 'Sign-up is disabled for this application.' })
                }
            })
        },
        socialProviders: {
            google: {
                clientId: env.GOOGLE_CLIENT_ID,
                clientSecret: env.GOOGLE_CLIENT_SECRET
            }
        },
        // 'https://example.com' matches the origin the test suite's synthetic requests use,
        // same as worker-auth's own trustedOrigins (see apps/worker-auth/src/auth.ts) — without
        // it, better-auth's originCheckMiddleware rejects the /oauth2/consent POST (which sends
        // an Origin header alongside the session cookie) with a 403 "Invalid origin" before the
        // request ever reaches the oauth-provider plugin's own consent handler.
        // env.BETTER_AUTH_URL is listed here defensively/redundantly — better-auth's own
        // getTrustedOrigins() (see node_modules/better-auth/dist/context/helpers.mjs) already
        // auto-trusts the app's configured baseURL origin, so this entry is a no-op. The
        // 'https://example.com' entry above is the one actually doing work.
        trustedOrigins: [env.BETTER_AUTH_URL, 'https://example.com'],
        plugins: [
            // oauthProvider signs OIDC id_tokens via the jwt plugin — a hard
            // dependency (throws BetterAuthError("jwt_config") without it),
            // not an optional pairing.
            jwt(),
            oauthProvider({
                loginPage: '/login',
                consentPage: '/consent',
                signup: { page: '/signup' },
                // Required for src/routes/{login,signup,consent}.tsx's client-name lookups
                // (POST /api/auth/oauth2/public-client-prelogin) to work at all — without this,
                // @better-auth/oauth-provider's publicSessionMiddleware unconditionally throws
                // BAD_REQUEST on that endpoint, and the pages silently fall back to showing the
                // raw client_id instead of the client's display name.
                allowPublicClientPrelogin: true,
                // Per OIDC Core §5.4, standard claims (email included) are normally delivered
                // only via /userinfo, never the id_token. worker-admin decodes the id_token
                // locally (@capstone/auth-verify) and never calls /userinfo, and its
                // verifyAccessToken requires an `email` claim — so without this, every id_token
                // fails that check and worker-admin bounces back to /login right after signing in.
                customIdTokenClaims: ({ user, scopes }) => (scopes.includes('email') ? { email: user.email } : {})
            })
        ]
    })
}
