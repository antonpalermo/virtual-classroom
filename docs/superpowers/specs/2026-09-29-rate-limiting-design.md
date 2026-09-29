# Rate limiting for worker-oidc

## Context

`worker-oidc` (`@capstone/openid-connect`) is the shared identity provider for `worker-admin` and `worker-client` — email/password sign-in, Google sign-in, and self-service password reset (see the `2026-09-19-worker-oidc-react-pages-design.md` and password-reset changes). None of its endpoints are rate-limited today in any real sense.

Better Auth (pinned `^1.7.1`) ships a built-in rate limiter, but it's effectively dormant here: its default is `enabled: options.rateLimit?.enabled ?? isProduction`, and `isProduction` is `process.env.NODE_ENV === 'production'` evaluated once at module load (`@better-auth/core`'s `env-impl.mjs`). Cloudflare Workers doesn't set `NODE_ENV`, `wrangler.jsonc` doesn't set it, and `worker/auth.ts` never sets `rateLimit.enabled` explicitly — so the built-in protection has never actually been on, in dev or in production. This was confirmed by reading the pinned package's source directly (`node_modules/better-auth/dist/context/create-context.mjs:171`, `node_modules/@better-auth/core/dist/env/env-impl.mjs`), not from (possibly stale) docs.

This matters concretely for `POST /api/auth/sign-in/email` (credential guessing), `POST /api/auth/request-password-reset` (account enumeration via response timing/side channels, already mitigated at the response-shape level but not at the request-volume level), `POST /api/auth/reset-password` (the actual token-redemption step — guessing a reset token), and `POST /api/invites/accept` (guessing an invite token) — all reachable anonymously, all outside any session/role gate.

## Goals

- Real request-rate limiting on the endpoints above, backed by storage that's actually consistent under concurrent requests (see "Why not Workers KV" below).
- No new Cloudflare binding — reuse `OIDC_DB` (D1), already bound and already used for every other piece of durable state this worker has (`verification`, `invite`, `user`, etc.).
- Don't break the existing 61-test suite, none of whose synthetic requests currently carry a client-IP header.

## Non-goals

- `/internal/*` (client-bootstrap, admin-bootstrap routes) — already gated by a `Bearer <BETTER_AUTH_SECRET>` header; guessing a 32+ character secret isn't a rate-limit-shaped threat.
- `/api/admin/*` — already gated by a valid, role-checked session. Rate limiting it would be a request-volume/API-abuse concern, a different problem from the credential/token-guessing threat this change targets.
- Account lockout (a separate, stateful "N failures disables the account" mechanism) — out of scope; this is request-rate limiting only.
- Cloudflare's dashboard/WAF-level Rate Limiting Rules — considered and rejected, see below.
- A Durable-Object-based limiter — considered and rejected, see below.

## Why not Workers KV

Workers KV was evaluated and doesn't fit a security-critical request counter:

- **No atomic increment.** KV's API is `get`/`put` only. A limiter needs an atomic "read count, compare to max, increment" step; without it, two concurrent requests can both read the same stale count and both pass, undercounting exactly during a burst — the scenario the limiter exists for.
- **Eventual consistency.** KV writes can take up to 60 seconds to propagate globally across edge locations; a retry landing on a different colo can read a stale pre-attack value.
- **Wrong access pattern.** KV is tuned for high-read/low-write data. A rate-limited key is by definition a hot key under attack — the worst-case KV access pattern, both for its own soft per-key write guidance and for cost (every check is a billed write).

Better Auth's own `secondaryStorage` rate-limit path requires the store to expose an atomic `increment(key, ttl)` primitive; Workers KV doesn't have one, so wiring it in would mean hand-rolling a non-atomic get+put underneath it anyway — reintroducing the first problem.

## Why not Cloudflare's native Rate Limiting Rules

Zone/WAF-level rules don't touch application code or D1, but: they aren't exercised by `npm run test:run` (no way to verify behavior the way this repo verifies everything else), aren't managed as code anywhere in this repo (no Terraform/API-driven config precedent to follow), and Cloudflare's custom Rate Limiting Rules product typically needs a paid plan tier — this would be an undocumented, unversioned manual dashboard step.

## Why not a Durable Object

A dedicated DO class would give strong consistency by construction, but at the cost of a new binding, a new DO class, and a migration — solving a scaling problem this low-traffic OIDC provider doesn't have. D1's atomic conditional `UPDATE ... WHERE count < max` (what Better Auth's own `storage: "database"` path already uses) is sufficient at this scale.

## Architecture

Two mechanisms, one table:

1. **Better Auth's built-in limiter, `storage: 'database'`**, for everything under `/api/auth/*`. Confirmed by reading `node_modules/better-auth/dist/api/rate-limiter/index.mjs`: this performs the check-and-increment as a single atomic step at request time (`onRequestRateLimit`), via `db.incrementOne` with a conditional `WHERE` clause — not a separate read-then-write.
2. **A small hand-rolled middleware** for `POST /api/invites/accept`, which lives outside Better Auth's `/api/auth/*` handler entirely (it's `worker/accept-invite.ts`'s own Hono route). It targets the *same* `rateLimit` table Better Auth's own config creates, using the same atomic-`UPDATE` pattern. Reaching into a Better Auth-owned table from hand-written code already has precedent in this worker — `test/password-reset.test.ts` reads the `verification` table directly, and `worker/admin-users.ts`'s `setUserPassword` already mirrors internal Better Auth logic for the same reason (no better first-party API for the job).

### IP resolution

`advanced.ipAddress.ipAddressHeaders: ['cf-connecting-ip']` in `worker/auth.ts`. Better Auth's default header is `x-forwarded-for` (confirmed in `node_modules/@better-auth/core/dist/utils/ip.mjs`'s `DEFAULT_IP_HEADERS`), which isn't the Workers-canonical trusted source. `CF-Connecting-IP` is set by Cloudflare's edge on every request reaching a Worker and can't be spoofed by the client.

### Endpoint policy

| Endpoint | Mechanism | Window | Max | Notes |
|---|---|---|---|---|
| `/sign-in/*` (email + social) | Better Auth built-in default | 10s | 3 | unchanged, already Better Auth's own default special rule |
| `/request-password-reset`, `/forget-password*` | Better Auth built-in default | 60s | 3 | unchanged, already Better Auth's own default special rule |
| `/reset-password` (token redemption) | **new** `customRules` entry | 60s | 5 | not covered by Better Auth's defaults today — falls back to the loose 100/10s global limit otherwise, which is far too permissive for a token-guessing surface |
| `POST /api/invites/accept` (token redemption) | **new** hand-rolled middleware, same table | 60s | 5 | outside `/api/auth/*`, Better Auth's limiter never sees it |
| everything else under `/api/auth/*` | Better Auth built-in global default | 10s | 100 | unchanged |

`customRules` keys are matched against the path with Better Auth's own `/api/auth` base stripped (confirmed via `normalizePathname(req.url, basePath)` in `create-context.mjs` and `resolveRateLimitConfig` in the rate-limiter module) — so the key is the bare `'/reset-password'`, not `'/api/auth/reset-password'`.

### `worker/auth.ts` changes

```ts
rateLimit: {
    enabled: true,
    storage: 'database',
    customRules: {
        '/reset-password': { window: 60, max: 5 }
    }
},
advanced: {
    ipAddress: {
        ipAddressHeaders: ['cf-connecting-ip']
    }
}
```

### Data model

`auth.cli.ts`'s generator config gains the same `rateLimit: { storage: 'database' }` option, so the standard, already-documented regen workflow produces the table:

```bash
npx auth@1.7.1 generate --config ./auth.cli.ts --adapter drizzle --dialect sqlite --output worker/db/schema.ts -y
npx drizzle-kit generate
```

This adds one generated table, confirmed via `@better-auth/core`'s `get-tables.mjs` (`shouldAddRateLimitTable = options.rateLimit?.storage === "database"`):

- `rateLimit.key` (string) — `${ip}|${path}`, Better Auth's own key format (`createRateLimitKey`).
- `rateLimit.count` (number)
- `rateLimit.lastRequest` (number, epoch ms)

No hand-added table — unlike `invite`/`role`/`banned`, this one comes straight from the generator once the option is set, expected to be a clean additive diff (same expectation the existing `worker/db/schema.ts` comment already documents for other config-driven regens).

### New `worker/rate-limit.ts`

A small, self-contained module — not a reimplementation of Better Auth's full rate-limiter (no plugin hooks, no configurable storage backends, just the one path this worker needs):

```ts
export async function consumeRateLimit(db: Db, key: string, windowSeconds: number, max: number): Promise<boolean>
```

Atomic conditional increment against the `rateLimit` table, following the same two-step shape Better Auth's own `createDatabaseStorageWrapper` uses (`node_modules/better-auth/dist/api/rate-limiter/index.mjs`): insert a fresh row if none exists; if the window has elapsed, reset the count; otherwise a conditional `UPDATE ... WHERE lastRequest > windowStart AND count < max` — if it affects zero rows, the caller is over the limit.

Plus a tiny Hono middleware factory:

```ts
export function rateLimitByIp(path: string, windowSeconds: number, max: number): MiddlewareHandler<{ Bindings: Env }>
```

Reads `cf-connecting-ip`, builds the `${ip}|${path}` key (matching Better Auth's own format so both mechanisms' rows are visually consistent in the one table, even though nothing cross-reads them), calls `consumeRateLimit`, and on rejection returns a `429` matching Better Auth's own shape (`{ message: "Too many requests. Please try again later." }`, `X-Retry-After` header) rather than inventing a different error format for one endpoint.

### `worker/index.ts` change

```ts
app.use('/api/invites/accept', rateLimitByIp('/api/invites/accept', 60, 5))
```

Registered before `registerAcceptInviteRoute(app)`'s handler runs (Hono middleware ordering — matches the existing comment pattern already in this file for `registerWorkerAdminAuthorizeGate`).

## Testing

### Test infrastructure fix (required first)

None of the ~10 existing test files, nor the two shared helpers (`test/helpers/call-app.ts`, `test/helpers/sign-in.ts`), set any client-IP header on their synthetic requests. Confirmed via `getIP` (`@better-auth/core/dist/utils/ip.mjs`): with no matching header, it falls through to `isTest() || isDevelopment()` (both `NODE_ENV`-gated, and — per the same finding as `isProduction` above — not reliably true inside `@cloudflare/vitest-pool-workers`' workerd sandbox) and ultimately `resolveRateLimitConfig` collapses every such request onto one shared `"no-trusted-ip"` bucket. Turning rate limiting on without addressing this would make the existing 61-test suite trip the 3-req/10s sign-in limit on itself within any single test file (test requests execute well within a 10-second wall-clock window, and D1 state is already known not to be isolated per-`it()` within a file — same caveat already documented for the `verification` table in the password-reset tests).

Fix, scoped to one file: `test/helpers/call-app.ts`'s `callAsApp` assigns a fresh random synthetic `cf-connecting-ip` (a random IPv4) to the outgoing request *unless the caller's `Request` already sets that header*. Existing test files need zero changes — each of their calls gets its own effectively-unique bucket, which is a closer match to today's *effective* behavior (no real limiting) than a shared bucket would be. Only the new rate-limit test file deliberately constructs requests with a fixed, explicit `cf-connecting-ip` header reused across several calls, to force and verify a collision.

### New `test/rate-limit.test.ts`

1. Sign-in: 4 rapid attempts from the same synthetic IP — 4th is `429`.
2. `request-password-reset`: 4 rapid attempts from the same IP — 4th is `429`.
3. `reset-password`: 6 rapid attempts (valid or invalid token, doesn't matter for this check) from the same IP — 6th is `429`. Proves the new custom rule is actually applied, not just the loose 100/10s global default.
4. `POST /api/invites/accept`: 6 rapid attempts from the same IP — 6th is `429`. Proves the hand-rolled middleware.
5. A second, different synthetic IP hitting the same endpoint immediately after case 1's limit trips is *not* rejected — proves the key is correctly scoped per-IP, not global.

## Documentation

New "## Rate limiting" section in `apps/worker-oidc/CLAUDE.md`, matching the existing "## Password reset" section's style: what's protected and why, the endpoint policy table above, the `cf-connecting-ip` header choice, and a one-line pointer to `worker/rate-limit.ts` for the one endpoint outside Better Auth's own handler. Also: a bullet for `worker/rate-limit.ts` under the `worker/` file list, a bullet for `rate-limit.test.ts` under the test-file list, and a one-line addition to `test/helpers/call-app.ts`'s existing description noting the synthetic-IP-per-call behavior.

## Versioning

`npm run changeset`, `@capstone/openid-connect` only, minor bump.

## Implementation order

1. `auth.cli.ts` — add `rateLimit: { storage: 'database' }` to the generator config.
2. Regenerate: `npx auth@1.7.1 generate --config ./auth.cli.ts --adapter drizzle --dialect sqlite --output worker/db/schema.ts -y`, review the diff (expect only the additive `rateLimit` table), then `npx drizzle-kit generate`.
3. `worker/auth.ts` — add the `rateLimit` and `advanced.ipAddress` config.
4. `worker/rate-limit.ts` — new module (`consumeRateLimit`, `rateLimitByIp`).
5. `worker/index.ts` — wire the middleware onto `/api/invites/accept`.
6. `test/helpers/call-app.ts` — synthetic-IP-per-call fix.
7. `test/rate-limit.test.ts` — all 5 cases.
8. `npm run migrations:auth` — apply the new migration locally before running tests.
9. `apps/worker-oidc/CLAUDE.md` — documentation edits above.
10. `npm run changeset`.

## Verification

- `npm run lint -w @capstone/openid-connect`
- `npm run build -w @capstone/openid-connect`
- `npm run test:run -w @capstone/openid-connect` — full suite green, including the existing 61 tests (unaffected by the synthetic-IP fix) and the 5 new rate-limit cases.
- Manual dev-server check: `npm run dev -w @capstone/openid-connect`, attempt sign-in with a wrong password 4 times in a row, confirm the 4th response is a `429` with a `Retry-After`-shaped signal.
