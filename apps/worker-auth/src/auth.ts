import { oauthProvider } from '@better-auth/oauth-provider'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin, bearer, jwt } from 'better-auth/plugins'
import { ac, adminRole, managerRole, userRole } from './access-control'
import type { Db } from './db/client'

export function createAuth(db: Db, env: Env) {
    return betterAuth({
        baseURL: env.BETTER_AUTH_URL,
        secret: env.BETTER_AUTH_SECRET,
        database: drizzleAdapter(db, { provider: 'sqlite' }),
        socialProviders: {
            google: {
                clientId: env.GOOGLE_CLIENT_ID,
                clientSecret: env.GOOGLE_CLIENT_SECRET
            }
        },
        user: {
            additionalFields: {
                role: {
                    type: 'string',
                    required: false,
                    defaultValue: 'user',
                    input: false
                }
            }
        },
        // 'https://example.com' matches the origin the test suite's synthetic requests use.
        // 'http://localhost:8790' is worker-admin's fixed local dev port
        // (apps/worker-admin/wrangler.jsonc) — its calls proxy through here and need to pass
        // Better Auth's origin check.
        trustedOrigins: [env.BETTER_AUTH_URL, 'https://example.com', 'http://localhost:8790'],
        plugins: [
            jwt(),
            oauthProvider({
                loginPage: '/login',
                consentPage: '/consent'
            }),
            admin({
                ac,
                roles: { admin: adminRole, manager: managerRole, user: userRole },
                // adminUserIds bootstraps the first admin account(s) without a manual DB write
                // or an existing admin to grant the role — any user whose id is listed here is
                // treated as an admin regardless of their `role` column (confirmed against
                // node_modules/better-auth/dist/plugins/admin/has-permission.mjs). Comma-separated
                // Better Auth user ids; further admins get promoted via /admin/set-role instead.
                adminUserIds:
                    env.ADMIN_USER_IDS?.split(',')
                        .map(id => id.trim())
                        .filter(Boolean) ?? []
            }),
            // Converts an `Authorization: Bearer <token>` header into the same session a cookie
            // would carry, so worker-admin — a separate origin with no cookie of its own, since
            // Google's redirect_uri (and so the session cookie) is pinned to worker-client's
            // origin — can forward a session established there through its proxy. See
            // docs/superpowers/specs/2026-09-12-worker-admin-design.md.
            bearer()
        ]
    })
}
