// Used only by `npx auth@latest generate` to produce src/db/schema.ts.
// The CLI runs under plain Node.js and has no real D1 binding available,
// so this constructs `createAuth` with a placeholder database — schema
// generation only reads the configured plugins/fields, it never queries.
// Never imported by the real Worker (see src/index.ts).
import { drizzle } from 'drizzle-orm/d1'
import { createAuth } from './src/auth'

const placeholderD1 = {} as D1Database
const db = drizzle(placeholderD1)

export const auth = createAuth(db, {
    BETTER_AUTH_URL: 'http://localhost:8787',
    BETTER_AUTH_SECRET: 'cli-schema-generation-placeholder-secret-value-32',
    GOOGLE_CLIENT_ID: 'cli-placeholder',
    GOOGLE_CLIENT_SECRET: 'cli-placeholder'
} as Env)
