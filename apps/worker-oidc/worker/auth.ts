import { oauthProvider } from '@better-auth/oauth-provider'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError } from 'better-auth/api'
import { jwt } from 'better-auth/plugins'
import type { Db } from './db/client.js'

// role/banned/banExpires aren't in better-auth's base User type — they only ship with the
// `admin` plugin's schema merge, which this worker deliberately doesn't enable (see
// worker/admin-users.ts). The columns are real (worker/db/schema.ts), just not reflected in the
// imported type, hence the narrow cast at each read site below.
type UserWithRole = { banned?: boolean | null; banExpires?: Date | null; role?: string | null }

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
        // role/banned/banReason/banExpires are real columns (worker/db/schema.ts) but better-auth's
        // drizzle adapter only selects/writes columns it's been told about — without declaring
        // them here, the adapter silently omits them from every query, so any code that reads them
        // off a User (customIdTokenClaims below, or an internalAdapter.findUserById call) always
        // sees undefined regardless of the row's real values. `input: false` on each, same as the
        // `admin` plugin's own schema (node_modules/better-auth/dist/plugins/admin/schema.mjs),
        // keeps them out of any public-input-validated endpoint body (sign-up, update-user) — they
        // change only through worker/admin-users.ts's own direct Drizzle writes.
        user: {
            additionalFields: {
                role: { type: 'string', required: false, defaultValue: 'user', input: false },
                banned: { type: 'boolean', required: false, defaultValue: false, input: false },
                banReason: { type: 'string', required: false, input: false },
                banExpires: { type: 'date', required: false, input: false }
            }
        },
        // Not using the `admin` plugin (see worker/admin-users.ts for why), so its automatic
        // ban-at-sign-in check doesn't apply here — this is the same mechanism it uses
        // internally, hand-added: node_modules/better-auth/dist/plugins/admin/admin.mjs's own
        // `session.create.before` hook does exactly this (confirmed by reading it directly).
        databaseHooks: {
            session: {
                create: {
                    before: async (session, ctx) => {
                        if (!ctx) return
                        const currentUser = (await ctx.context.internalAdapter.findUserById(session.userId)) as UserWithRole | null
                        if (!currentUser?.banned) return
                        if (currentUser.banExpires && new Date(currentUser.banExpires).getTime() < Date.now()) {
                            // Ban has lapsed — lift it and let sign-in proceed, same as the admin
                            // plugin's own behavior, so a banned-until-a-date row doesn't need a
                            // separate manual unban.
                            await ctx.context.internalAdapter.updateUser(session.userId, {
                                banned: false,
                                banReason: null,
                                banExpires: null
                            })
                            return
                        }
                        throw APIError.from('FORBIDDEN', {
                            message: 'You have been banned from this application.',
                            code: 'BANNED_USER'
                        })
                    }
                }
            }
        },
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
                // role: populates the previously-dormant `role?: string` field already typed in
                // @capstone/auth-verify's AccessTokenClaims — worker-admin uses it for UI gating
                // only (not the security boundary; worker/admin-users.ts re-checks role fresh
                // against D1 on every call).
                customIdTokenClaims: ({ user, scopes }) =>
                    scopes.includes('email') ? { email: user.email, role: (user as UserWithRole).role ?? 'user' } : {}
            })
        ]
    })
}
