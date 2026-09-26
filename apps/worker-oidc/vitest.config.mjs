import path from 'node:path'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig(async () => {
    const migrations = await readD1Migrations(path.join(import.meta.dirname, 'drizzle'))

    return {
        plugins: [
            cloudflareTest({
                wrangler: { configPath: './wrangler.jsonc' },
                miniflare: {
                    bindings: { TEST_MIGRATIONS: migrations }
                }
            })
        ],
        test: {
            setupFiles: ['./test/apply-migrations.ts'],
            // The default 5s times out under load: several tests (and the whole suite, run as
            // multiple files in parallel) drive full sign-in -> consent -> token-exchange round
            // trips — real password hashing and JWT signing, not mocked — and that's routinely
            // slower than 5s on a loaded/shared CPU, independent of test correctness.
            testTimeout: 20_000
        }
    }
})
