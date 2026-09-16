import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import type { Db } from './db/client'

export function createAuth(db: Db, env: Env) {
    return betterAuth({
        baseURL: env.BETTER_AUTH_URL,
        secret: env.BETTER_AUTH_SECRET,
        database: drizzleAdapter(db, { provider: 'sqlite' }),
        emailAndPassword: {
            enabled: true
        }
    })
}
