import { applyD1Migrations } from 'cloudflare:test'
import { env } from 'cloudflare:workers'

// Setup files may run more than once; applyD1Migrations() only applies
// migrations that haven't already been applied, so this is safe to repeat.
await applyD1Migrations(env.AUTH_DB, env.TEST_MIGRATIONS)
