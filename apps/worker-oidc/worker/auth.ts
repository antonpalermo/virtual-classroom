import { oauthProvider } from '@better-auth/oauth-provider'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { jwt } from 'better-auth/plugins'
import type { Db } from './db/client.js'

export function createAuth(db: Db, env: Env) {
    return betterAuth({
        baseURL: env.BETTER_AUTH_URL,
        secret: env.BETTER_AUTH_SECRET,
        database: drizzleAdapter(db, { provider: 'sqlite' }),
        emailAndPassword: {
            enabled: true
        },
        // No self-service accounts: admins are seeded via worker/bootstrap-admin-user.ts
        // (invite links are the planned longer-term mechanism). disabledPaths only gates the
        // HTTP router (see node_modules/better-auth/dist/api/index.mjs's onRequest), so it 404s
        // any caller reaching /sign-up/email over HTTP — including worker-admin's own flow —
        // while auth.api.signUpEmail (what bootstrap-admin-user.ts calls) still works, since it
        // never goes through the router. Better Auth's own emailAndPassword.disableSignUp flag
        // would block that internal call too, since it's checked inside the endpoint handler
        // itself rather than at the router.
        disabledPaths: ['/sign-up/email'],
        socialProviders: {
            google: {
                clientId: env.GOOGLE_CLIENT_ID,
                clientSecret: env.GOOGLE_CLIENT_SECRET,
                // Same "no self-service accounts" rule applies to Google sign-in, which would
                // otherwise silently create a user on first login. A Google account with no
                // matching existing user now gets redirected back with ?error=signup_disabled
                // (src/GoogleButton.tsx) instead.
                disableSignUp: true
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
                // Required for src/routes/{login,consent}.tsx's client-name lookups
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
