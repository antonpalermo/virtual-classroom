# worker-oidc React Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert `worker-oidc`'s `/login`, `/signup`, and `/consent` pages from hand-written HTML strings served by the Hono app into React components, built with Vite and routed with TanStack Router, matching the Worker + static-assets hybrid pattern `apps/worker-client` already uses in this repo.

**Architecture:** Today's backend (`src/index.ts`, `src/auth.ts`, `src/db/*`, `src/register-worker-admin-client.ts`) moves into `worker/` unchanged, keeping `/api/auth/*` and `/internal/*` as the only paths the Worker handles (via `wrangler.jsonc`'s `assets.run_worker_first`). `src/` becomes a fresh Vite + React + TanStack Router SPA serving everything else, including the three pages. Each page fetches the same Better Auth HTTP endpoints its current inline `<script>` already calls — no new server-side endpoint is added; the pages additionally call the plugin's existing public `/api/auth/oauth2/public-client-prelogin` endpoint to show the requesting OAuth client's display name.

**Tech Stack:** React 19, TanStack Router (`@tanstack/react-router` + `@tanstack/router-plugin`), Vite 8, `@cloudflare/vite-plugin`, Hono (unchanged, Worker half only), Better Auth + `@better-auth/oauth-provider` (unchanged), Drizzle/D1 (unchanged).

**Spec:** `docs/superpowers/specs/2026-09-19-worker-oidc-react-pages-design.md`

## Global Constraints

- No new server-side data endpoint. Pages call existing Better Auth HTTP routes only — same-origin, so no `VITE_*`-prefixed env vars are needed anywhere in this plan.
- No automated component/route tests for the new pages — matches the established `worker-admin`/`worker-client` precedent (confirmed with the user). Verification for page-authoring tasks is `npm run build` (type-check + bundle) succeeding, plus the existing Worker-side test suite staying green.
- Directory convention: `worker/` for backend Worker code, `src/` for the React frontend — mirrors `apps/worker-client` exactly, not `apps/worker-admin` (which has no backend at all).
- New dependency versions copied verbatim from `apps/worker-admin/package.json` (the most recently added sibling on this exact toolchain): `react`/`react-dom` `^19.2.8`, `@tanstack/react-router` `^1.170.31`, `@tanstack/react-router-devtools` `^1.167.1`, `@cloudflare/vite-plugin` `^1.53.0`, `@tanstack/router-plugin` `^1.168.34`, `@vitejs/plugin-react` `^6.0.4`, `vite` `^8.2.0`, `@types/react` `^19.2.17`, `@types/react-dom` `^19.2.3`, `@types/node` `^24.13.3`.
- `worker-oidc`'s Vite dev port (`8791`) and inspector port (`9233`) stay the same numbers they are today — only the mechanism serving them changes (from `wrangler dev` directly to the Cloudflare Vite plugin). No other worker's port config needs to change.

---

### Task 1: Move the backend into `worker/`, delete the HTML pages

**Files:**
- Move: `apps/worker-oidc/src/` → `apps/worker-oidc/worker/` (whole directory: `index.ts`, `auth.ts`, `db/client.ts`, `db/schema.ts`, `register-worker-admin-client.ts`)
- Delete: `apps/worker-oidc/worker/pages.ts` (after the move, this is the old `src/pages.ts`)
- Delete: `apps/worker-oidc/test/pages.test.ts`
- Modify: `apps/worker-oidc/worker/index.ts`
- Modify: `apps/worker-oidc/auth.cli.ts`
- Modify: `apps/worker-oidc/drizzle.config.ts`
- Modify: `apps/worker-oidc/test/helpers/call-app.ts`
- Modify: `apps/worker-oidc/test/register-worker-admin-client.test.ts`

**Interfaces:**
- Consumes: nothing new — this is a pure move/cleanup of existing code, no behavior change to any endpoint.
- Produces: `worker/index.ts` exporting the same default Hono `app` as before, minus page-serving. `worker/auth.ts`'s `createAuth`, `worker/db/client.ts`'s `createDb`/`Db`, `worker/db/schema.ts`'s tables, and `worker/register-worker-admin-client.ts`'s `registerBootstrapRoute`/`BOOTSTRAP_USER_ID`/`BOOTSTRAP_USER_EMAIL` — all identical exports to today, just at a new import path (`./worker/...` from the app root, `./...` unchanged from within `worker/`).

- [ ] **Step 1: Move the directory and delete superseded files**

```bash
cd apps/worker-oidc
git mv src worker
git rm worker/pages.ts
git rm test/pages.test.ts
```

- [ ] **Step 2: Update `worker/index.ts`** — remove the `pages.ts` import/registration and the now-dead `/` health route (once Task 2 adds `assets.run_worker_first: ["/api/auth/*", "/internal/*"]` to `wrangler.jsonc`, `/` is served by the SPA and this Hono route would never be reached in real traffic)

Replace the full contents of `apps/worker-oidc/worker/index.ts` with:

```ts
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { createAuth } from './auth'
import { createDb } from './db/client'
import { registerBootstrapRoute } from './register-worker-admin-client'

const app = new Hono<{ Bindings: Env }>()

registerBootstrapRoute(app)

// These three are called directly, cross-origin, from worker-admin's browser JS (no service
// binding involved) — a public JWKS, a userinfo lookup gated by the caller's own access token,
// and a token exchange gated by the caller's own authorization code + PKCE verifier. None of
// them are guarded by a cookie, so opening CORS wide doesn't leak anything the caller didn't
// already have. Same reasoning worker-auth already applied to its own /api/auth/jwks.
app.use('/api/auth/jwks', cors())
app.use('/api/auth/oauth2/userinfo', cors())
app.use('/api/auth/oauth2/token', cors())

app.all('/api/auth/*', c => {
    const db = createDb(c.env.OIDC_DB)
    const auth = createAuth(db, c.env)
    return auth.handler(c.req.raw)
})

export default app
```

- [ ] **Step 3: Update `apps/worker-oidc/auth.cli.ts`'s imports**

Change:
```ts
import { createAuth } from './src/auth'
import { createDb } from './src/db/client'
```
to:
```ts
import { createAuth } from './worker/auth'
import { createDb } from './worker/db/client'
```

- [ ] **Step 4: Update `apps/worker-oidc/drizzle.config.ts`'s schema path**

Change `schema: './src/db/schema.ts'` to `schema: './worker/db/schema.ts'`.

- [ ] **Step 5: Update `apps/worker-oidc/test/helpers/call-app.ts`'s import**

Change `import app from '../../src/index'` to `import app from '../../worker/index'`.

- [ ] **Step 6: Update `apps/worker-oidc/test/register-worker-admin-client.test.ts`'s imports**

Change:
```ts
import { createDb } from '../src/db/client'
import { oauthClient, user } from '../src/db/schema'
import { BOOTSTRAP_USER_EMAIL, BOOTSTRAP_USER_ID } from '../src/register-worker-admin-client'
```
to:
```ts
import { createDb } from '../worker/db/client'
import { oauthClient, user } from '../worker/db/schema'
import { BOOTSTRAP_USER_EMAIL, BOOTSTRAP_USER_ID } from '../worker/register-worker-admin-client'
```

- [ ] **Step 7: Run the existing test suite and confirm nothing regressed**

Run: `npm run test:run -w @capstone/openid-connect`
Expected: PASS, 10 tests across `cors.test.ts` (3), `register-worker-admin-client.test.ts` (6), `oauth-client-flow.test.ts` (1) — `pages.test.ts`'s 3 tests are gone, as intended.

- [ ] **Step 8: Lint**

Run: `npm run lint -w @capstone/openid-connect`
Expected: PASS, no changes needed (this step is a pure move + two small deletions, nothing Biome should flag).

- [ ] **Step 9: Commit**

```bash
git add -A apps/worker-oidc
git commit -m "$(cat <<'EOF'
refactor(oidc): move backend into worker/, drop HTML pages

- move src/{index,auth,db,register-worker-admin-client} to worker/
- delete pages.ts and its Hono routes — page-serving moves to a React SPA next
- delete the now-inapplicable pages.test.ts
- repoint auth.cli.ts, drizzle.config.ts, and test imports at worker/
EOF
)"
```

---

### Task 2: Vite + React + TanStack Router scaffolding

**Files:**
- Modify: `apps/worker-oidc/package.json`
- Modify: `apps/worker-oidc/wrangler.jsonc`
- Modify: `apps/worker-oidc/tsconfig.json`
- Modify: `apps/worker-oidc/test/tsconfig.json`
- Create: `apps/worker-oidc/tsconfig.app.json`
- Create: `apps/worker-oidc/tsconfig.node.json`
- Create: `apps/worker-oidc/tsconfig.worker.json`
- Create: `apps/worker-oidc/vite.config.ts`
- Create: `apps/worker-oidc/index.html`
- Create: `apps/worker-oidc/src/main.tsx`
- Create: `apps/worker-oidc/src/routes/__root.tsx`
- Create: `apps/worker-oidc/src/routes/index.tsx`
- Generates: `apps/worker-oidc/src/routeTree.gen.ts` (via the TanStack Router Vite plugin — not hand-written)

**Interfaces:**
- Consumes: `worker/index.ts` and `wrangler.jsonc` from Task 1.
- Produces: a working `vite dev`/`vite build` setup with one placeholder route (`/`), ready for Task 3 to add `login.tsx`/`signup.tsx`/`consent.tsx` under `src/routes/`.

- [ ] **Step 1: Update `apps/worker-oidc/package.json`**

Replace the full file with:

```json
{
    "name": "@capstone/openid-connect",
    "version": "0.0.0",
    "private": true,
    "type": "module",
    "scripts": {
        "dev": "vite",
        "build": "tsc -b && vite build",
        "preview": "npm run build && vite preview",
        "deploy": "npm run build && wrangler deploy",
        "typegen": "wrangler types",
        "lint": "biome check .",
        "migrations:auth": "wrangler d1 migrations apply worker-oidc --local",
        "test": "vitest",
        "test:run": "vitest run"
    },
    "dependencies": {
        "@better-auth/oauth-provider": "^1.7.1",
        "@tanstack/react-router": "^1.170.31",
        "@tanstack/react-router-devtools": "^1.167.1",
        "better-auth": "^1.7.1",
        "drizzle-orm": "^0.45.2",
        "hono": "^4.13.5",
        "react": "^19.2.8",
        "react-dom": "^19.2.8"
    },
    "devDependencies": {
        "@capstone/typescript": "*",
        "@cloudflare/vite-plugin": "^1.53.0",
        "@cloudflare/vitest-pool-workers": "^0.22.0",
        "@cloudflare/workers-types": "^5.20260826.1",
        "@tanstack/router-plugin": "^1.168.34",
        "@types/node": "^24.13.3",
        "@types/react": "^19.2.17",
        "@types/react-dom": "^19.2.3",
        "@vitejs/plugin-react": "^6.0.4",
        "drizzle-kit": "^0.31.10",
        "typescript": "^7.0.2",
        "vite": "^8.2.0",
        "vitest": "^4.1.11",
        "wrangler": "^4.126.0"
    }
}
```

Note: `"start": "wrangler dev"` is dropped — `dev` now runs through Vite, matching `worker-admin`/`worker-client` (neither has a `start` script). Nothing else in the repo references worker-oidc's `start` script (confirmed by grep before writing this plan).

- [ ] **Step 2: Install the new dependencies from the repo root**

```bash
npm install
```

Run this from the repo root (`/home/sono/virtual-classroom`), not from `apps/worker-oidc` — npm workspaces resolves and hoists from the root lockfile.

- [ ] **Step 3: Update `apps/worker-oidc/wrangler.jsonc`**

Replace the full file with:

```jsonc
/**
 * For more details on how to configure Wrangler, refer to:
 * https://developers.cloudflare.com/workers/wrangler/configuration/
 */
{
    "$schema": "../../node_modules/wrangler/config-schema.json",
    "name": "worker-oidc",
    "main": "worker/index.ts",
    "compatibility_date": "2026-08-22",
    "d1_databases": [
        {
            "binding": "OIDC_DB",
            "database_name": "worker-oidc",
            "database_id": "00000000-0000-0000-0000-000000000000",
            "migrations_dir": "drizzle"
        }
    ],
    "assets": {
        "not_found_handling": "single-page-application",
        "run_worker_first": ["/api/auth/*", "/internal/*"]
    },
    "observability": {
        "enabled": true
    },
    "upload_source_maps": true
}
```

The `dev` block (`port`/`inspector_port`) is removed — those now live in `vite.config.ts` (Step 5), the same way `worker-admin`/`worker-client` configure them.

- [ ] **Step 4: Split `apps/worker-oidc/tsconfig.json` into three project configs**

Create `apps/worker-oidc/tsconfig.app.json`:

```json
{
    "extends": "@capstone/typescript/configs/tsconfig.app.json",
    "compilerOptions": {
        "tsBuildInfoFile": "../../node_modules/.tmp/openid-connect/tsconfig.app.tsbuildinfo"
    },
    "include": ["src"]
}
```

Create `apps/worker-oidc/tsconfig.node.json`:

```json
{
    "extends": "@capstone/typescript/configs/tsconfig.node.json",
    "compilerOptions": {
        "tsBuildInfoFile": "../../node_modules/.tmp/openid-connect/tsconfig.node.tsbuildinfo"
    },
    "include": ["vite.config.ts"]
}
```

Create `apps/worker-oidc/tsconfig.worker.json` — same base the single old config used, plus `vite/client` (needed once `worker/index.ts`'s sibling `vite.config.ts` exists in the same project) and explicit `include` for the two root-level Node scripts that the old implicit "include everything in this directory" behavior used to cover:

```json
{
    "extends": "@capstone/typescript/configs/tsconfig.node.json",
    "compilerOptions": {
        "tsBuildInfoFile": "../../node_modules/.tmp/openid-connect/tsconfig.worker.tsbuildinfo",
        "types": ["./worker-configuration.d.ts", "vite/client", "node"]
    },
    "include": ["worker", "auth.cli.ts", "drizzle.config.ts"]
}
```

Replace `apps/worker-oidc/tsconfig.json` with a references-only shell:

```json
{
    "files": [],
    "references": [
        {
            "path": "./tsconfig.app.json"
        },
        {
            "path": "./tsconfig.node.json"
        },
        {
            "path": "./tsconfig.worker.json"
        }
    ]
}
```

- [ ] **Step 5: Update `apps/worker-oidc/test/tsconfig.json`**

Its `extends` target used to be the single flat `../tsconfig.json`, which had real `compilerOptions`. After Step 4, `../tsconfig.json` is references-only (no `compilerOptions` of its own), so re-point at `../tsconfig.worker.json` instead — same base, same types, now living there:

```json
{
    "extends": "../tsconfig.worker.json",
    "compilerOptions": {
        "types": ["@cloudflare/vitest-pool-workers/types", "node"]
    },
    "include": ["./**/*.ts", "../worker-configuration.d.ts"]
}
```

- [ ] **Step 6: Create `apps/worker-oidc/vite.config.ts`**

```ts
import { cloudflare } from '@cloudflare/vite-plugin'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
    // Same port/inspector-port worker-oidc already used with `wrangler dev` directly — only the
    // mechanism serving them changed. worker-client, worker-realtime, worker-auth, and
    // worker-admin use 5173/9229, 8788/9231, 8789/9230, and 8790/9232 respectively.
    server: { port: 8791 },
    plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), cloudflare({ inspectorPort: 9233 })]
})
```

- [ ] **Step 7: Create `apps/worker-oidc/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>worker-oidc</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 8: Create `apps/worker-oidc/src/main.tsx`**

```tsx
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Import the generated route tree
import { routeTree } from './routeTree.gen'

// Create a new router instance
const router = createRouter({ routeTree })

// Register the router instance for type safety
declare module '@tanstack/react-router' {
    interface Register {
        router: typeof router
    }
}

createRoot(document.getElementById('root') as HTMLElement).render(
    <StrictMode>
        <RouterProvider router={router} />
    </StrictMode>
)
```

- [ ] **Step 9: Create `apps/worker-oidc/src/routes/__root.tsx`**

```tsx
import { createRootRoute, Outlet } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'

const RootLayout = () => (
    <>
        <Outlet />
        <TanStackRouterDevtools />
    </>
)

export const Route = createRootRoute({ component: RootLayout })
```

- [ ] **Step 10: Create `apps/worker-oidc/src/routes/index.tsx`** (placeholder — this worker isn't meant to be browsed at its bare root by a real user)

```tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
    component: IndexRoute
})

function IndexRoute() {
    return <p className="p-2">worker-oidc — OpenID Connect provider.</p>
}
```

- [ ] **Step 11: Build and confirm the route tree generates**

Run: `npm run build -w @capstone/openid-connect`
Expected: PASS. This also generates `apps/worker-oidc/src/routeTree.gen.ts` (via the TanStack Router Vite plugin watching `src/routes/`) and a `dist/` directory (gitignored).

Confirm the generated file exists: `test -f apps/worker-oidc/src/routeTree.gen.ts && echo exists`

- [ ] **Step 12: Confirm the Worker-side test suite is unaffected**

Run: `npm run test:run -w @capstone/openid-connect`
Expected: PASS, same 10 tests as Task 1 — none of this task's changes touch `worker/`.

- [ ] **Step 13: Lint**

Run: `npm run lint -w @capstone/openid-connect`
Expected: PASS.

- [ ] **Step 14: Commit**

```bash
git add apps/worker-oidc package-lock.json
git commit -m "$(cat <<'EOF'
feat(oidc): scaffold Vite + React + TanStack Router SPA

- add vite.config.ts, index.html, main.tsx, and a placeholder root/index route
- split tsconfig.json into app/node/worker project references, matching worker-client
- set wrangler.jsonc's assets.run_worker_first to /api/auth/* and /internal/* only
EOF
)"
```

---

### Task 3: Build the login, signup, and consent pages

**Files:**
- Create: `apps/worker-oidc/src/routes/login.tsx`
- Create: `apps/worker-oidc/src/routes/signup.tsx`
- Create: `apps/worker-oidc/src/routes/consent.tsx`

**Interfaces:**
- Consumes: the TanStack Router route registration from Task 2 (`createFileRoute`, `src/routeTree.gen.ts` auto-regenerating as new route files are added).
- Produces: the three real pages `worker-oidc`'s `oauthProvider` plugin config (`loginPage: '/login'`, `consentPage: '/consent'`, `signup: { page: '/signup' }` in `worker/auth.ts`, unchanged) redirects visitors to.

All three pages call `POST /api/auth/oauth2/public-client-prelogin` with `{ client_id, oauth_query }` to look up the requesting OAuth client's public `client_name` for display — this is a genuinely public endpoint (`publicSessionMiddleware`, no session required), not `SERVER_ONLY`, purpose-built for exactly this pre-authentication lookup. A failed/unrecognized lookup is swallowed and falls back to a generic heading (`login`/`signup`) or the raw `client_id` (`consent`, matching today's behavior).

- [ ] **Step 1: Create `apps/worker-oidc/src/routes/login.tsx`**

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { type FormEvent, useEffect, useState } from 'react'

export const Route = createFileRoute('/login')({
    component: LoginRoute
})

function LoginRoute() {
    const [clientName, setClientName] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const oauthQuery = window.location.search.slice(1)

    useEffect(() => {
        const clientId = new URLSearchParams(window.location.search).get('client_id')
        if (!clientId) return
        fetch('/api/auth/oauth2/public-client-prelogin', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ client_id: clientId, oauth_query: oauthQuery })
        })
            .then(response => (response.ok ? response.json() : null))
            .then((client: { client_name?: string } | null) => setClientName(client?.client_name ?? null))
            .catch(() => setClientName(null))
    }, [oauthQuery])

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        setError(null)
        const form = new FormData(event.currentTarget)
        const response = await fetch('/api/auth/sign-in/email', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: form.get('email'), password: form.get('password') })
        })
        if (!response.ok) {
            setError('Sign-in failed, please try again.')
            return
        }
        window.location.href = `/api/auth/oauth2/authorize?${oauthQuery}`
    }

    return (
        <div className="p-2">
            <h3>Sign in{clientName ? ` to continue to ${clientName}` : ''}</h3>
            <form onSubmit={handleSubmit}>
                <label>
                    Email <input type="email" name="email" required />
                </label>
                <label>
                    Password <input type="password" name="password" required />
                </label>
                <button type="submit">Sign in</button>
            </form>
            {error && <p style={{ color: 'red' }}>{error}</p>}
            <p>
                <a href={`/signup?${oauthQuery}`}>Need an account? Sign up</a>
            </p>
        </div>
    )
}
```

- [ ] **Step 2: Create `apps/worker-oidc/src/routes/signup.tsx`**

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { type FormEvent, useEffect, useState } from 'react'

export const Route = createFileRoute('/signup')({
    component: SignupRoute
})

function SignupRoute() {
    const [clientName, setClientName] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const oauthQuery = window.location.search.slice(1)

    useEffect(() => {
        const clientId = new URLSearchParams(window.location.search).get('client_id')
        if (!clientId) return
        fetch('/api/auth/oauth2/public-client-prelogin', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ client_id: clientId, oauth_query: oauthQuery })
        })
            .then(response => (response.ok ? response.json() : null))
            .then((client: { client_name?: string } | null) => setClientName(client?.client_name ?? null))
            .catch(() => setClientName(null))
    }, [oauthQuery])

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        setError(null)
        const form = new FormData(event.currentTarget)
        const signUpResponse = await fetch('/api/auth/sign-up/email', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: form.get('name'), email: form.get('email'), password: form.get('password') })
        })
        if (!signUpResponse.ok) {
            setError('Sign-up failed, please try again.')
            return
        }
        const continueResponse = await fetch('/api/auth/oauth2/continue', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ created: true, oauth_query: oauthQuery })
        })
        if (!continueResponse.ok) {
            setError('Could not continue sign-in, please try again.')
            return
        }
        const { url } = (await continueResponse.json()) as { url: string }
        window.location.href = url
    }

    return (
        <div className="p-2">
            <h3>Sign up{clientName ? ` to continue to ${clientName}` : ''}</h3>
            <form onSubmit={handleSubmit}>
                <label>
                    Name <input type="text" name="name" required />
                </label>
                <label>
                    Email <input type="email" name="email" required />
                </label>
                <label>
                    Password <input type="password" name="password" required />
                </label>
                <button type="submit">Sign up</button>
            </form>
            {error && <p style={{ color: 'red' }}>{error}</p>}
        </div>
    )
}
```

- [ ] **Step 3: Create `apps/worker-oidc/src/routes/consent.tsx`**

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

export const Route = createFileRoute('/consent')({
    component: ConsentRoute
})

function ConsentRoute() {
    const params = new URLSearchParams(window.location.search)
    const clientId = params.get('client_id') ?? ''
    const scope = params.get('scope') ?? ''
    const oauthQuery = window.location.search.slice(1)

    const [clientName, setClientName] = useState(clientId)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!clientId) return
        fetch('/api/auth/oauth2/public-client-prelogin', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ client_id: clientId, oauth_query: oauthQuery })
        })
            .then(response => (response.ok ? response.json() : null))
            .then((client: { client_name?: string } | null) => {
                if (client?.client_name) setClientName(client.client_name)
            })
            .catch(() => {})
    }, [clientId, oauthQuery])

    async function respond(accept: boolean) {
        setError(null)
        const response = await fetch('/api/auth/oauth2/consent', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ accept, oauth_query: oauthQuery })
        })
        if (!response.ok) {
            setError('Could not complete authorization, please try again.')
            return
        }
        const { url } = (await response.json()) as { url: string }
        window.location.href = url
    }

    return (
        <div className="p-2">
            <h3>{clientName} wants to sign you in</h3>
            <p>Requested access: {scope}</p>
            <button type="button" onClick={() => respond(true)}>
                Allow
            </button>
            <button type="button" onClick={() => respond(false)}>
                Deny
            </button>
            {error && <p style={{ color: 'red' }}>{error}</p>}
        </div>
    )
}
```

- [ ] **Step 4: Build**

Run: `npm run build -w @capstone/openid-connect`
Expected: PASS. `src/routeTree.gen.ts` regenerates to include the three new routes.

- [ ] **Step 5: Confirm the Worker-side test suite is still unaffected**

Run: `npm run test:run -w @capstone/openid-connect`
Expected: PASS, same 10 tests. In particular `oauth-client-flow.test.ts` still passes unmodified — it only ever exercised `/api/auth/*` and asserted on redirect `Location` header paths, never the page HTML itself.

- [ ] **Step 6: Lint**

Run: `npm run lint -w @capstone/openid-connect`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/worker-oidc/src
git commit -m "$(cat <<'EOF'
feat(oidc): build login, signup, and consent as React pages

- each page calls the same Better Auth endpoints its old inline <script> did
- add a public-client-prelogin fetch to show the requesting client's name
- preserve today's error-handling and OAuth query-string resume behavior
EOF
)"
```

---

### Task 4: Docs, changeset, and end-to-end smoke check

**Files:**
- Modify: `apps/worker-oidc/CLAUDE.md`
- Create: `.changeset/worker-oidc-react-pages.md`

**Interfaces:**
- Consumes: the complete implementation from Tasks 1–3.
- Produces: nothing new for other tasks — this is the final task in this plan.

- [ ] **Step 1: Rewrite `apps/worker-oidc/CLAUDE.md`**

Update it to describe the new architecture accurately. At minimum, it must state (verify each against the real files before writing, don't guess):
- The `worker/` (backend, matches `apps/worker-client`'s convention) vs `src/` (React SPA) split, and that `src/pages.ts` no longer exists.
- `wrangler.jsonc`'s `assets.run_worker_first: ["/api/auth/*", "/internal/*"]` — everything else is the built SPA.
- The three pages (`src/routes/login.tsx`, `signup.tsx`, `consent.tsx`) and what each calls, including `oauth2/public-client-prelogin` for the client-name lookup.
- Updated commands: `dev` is now `vite` (port `8791`, inspector `9233`, set in `vite.config.ts` — not `wrangler.jsonc` anymore), new `build`/`preview` scripts, `start` removed.
- Updated TypeScript config layout (three project references, matching `apps/worker-client/CLAUDE.md`'s description of its own).
- No automated tests exist for the three pages (matches `worker-admin`'s precedent) — note this explicitly as a known gap, same as `apps/worker-admin/CLAUDE.md` does for its own `login.tsx`/`auth-callback.tsx`.

- [ ] **Step 2: Add a changeset**

Run `npm run changeset` from the repo root. Select only `@capstone/openid-connect`, bump type **minor**. Summary text, e.g.:

```
worker-oidc's login, signup, and consent pages are now a Vite + React + TanStack Router SPA instead of hand-written HTML strings served by the Hono app. The Worker now only handles /api/auth/* and /internal/*; everything else is served as static assets. No behavior change to the OAuth/OIDC flow itself.
```

This produces `.changeset/<generated-name>.md` — verify it lists only `@capstone/openid-connect`.

- [ ] **Step 3: Manual dev-server smoke check**

This repo's sandbox has no working browser-automation tooling (confirmed in the prior `worker-admin-oidc-client` change), so this step substitutes an HTTP-level check that the Worker/assets split actually routes correctly — it does **not** confirm the React pages render correctly in a real browser, which remains a manual follow-up item (see Step 5).

```bash
cd apps/worker-oidc
test -f .dev.vars || (cp .dev.vars.example .dev.vars && echo "BETTER_AUTH_SECRET=dev-smoke-check-secret-value-32ch" >> .dev.vars)
npm run migrations:auth
npm run dev &
sleep 5
curl -s -o /dev/null -w "jwks: %{http_code}\n" http://localhost:8791/api/auth/jwks
curl -s -o /dev/null -w "login shell: %{http_code}\n" http://localhost:8791/login
curl -s http://localhost:8791/login | grep -q 'id="root"' && echo "login: SPA shell present"
curl -s -o /dev/null -w "spa fallback: %{http_code}\n" http://localhost:8791/some-nonexistent-path
kill %1
```

Expected: `jwks` returns `200` with real JWKS JSON (Worker-handled path); `login shell` and `spa fallback` both return `200` and contain `id="root"` (assets-served SPA shell, including the `not_found_handling: single-page-application` fallback for an unmatched path) rather than a Hono 404.

- [ ] **Step 4: Full regression pass**

```bash
npm run test:run -w @capstone/openid-connect
npm run build -w @capstone/openid-connect
npm run lint -w @capstone/openid-connect
```

Expected: all three PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker-oidc/CLAUDE.md .changeset
git commit -m "$(cat <<'EOF'
docs(oidc): rewrite CLAUDE.md for the React pages, add changeset

- describe the worker/ vs src/ split and assets.run_worker_first routing
- document the three page routes and the public-client-prelogin lookup
- note the manual-browser-check gap, same as worker-admin's precedent
EOF
)"
```

A real human browser click-through (sign up, sign in, see the client name render on consent, accept, land back on `worker-admin`) is still needed before considering this fully verified — flag this explicitly when handing off this branch, the same gap the prior `worker-admin-oidc-client` PR flagged for its own pages.

---

## Self-Review Notes

- **Spec coverage:** Directory restructuring (Task 1–2), page implementation calling existing endpoints incl. `public-client-prelogin` (Task 3), `wrangler.jsonc`/tooling/testing/versioning (Tasks 2 & 4) all map to spec sections. No spec requirement lacks a task.
- **Placeholder scan:** No TBD/TODO; all code blocks are complete, runnable content.
- **Type consistency:** `createDb`/`Db` (from `worker/db/client.ts`), `createAuth` (from `worker/auth.ts`), `registerBootstrapRoute`/`BOOTSTRAP_USER_ID`/`BOOTSTRAP_USER_EMAIL` (from `worker/register-worker-admin-client.ts`) are referenced with identical names/paths everywhere they're used across tasks. The `client_name` field name (confirmed against `@better-auth/oauth-provider`'s `schemaToOAuth`) is used consistently in all three page components in Task 3.
