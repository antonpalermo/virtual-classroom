# Client → Auth Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect `worker-client` to `worker-auth` over a Cloudflare service binding and add a minimal `/login` page, so the browser can complete Google sign-in through Better Auth while the session cookie stays first-party to the client.

**Architecture:** `worker-client`'s existing passthrough worker (`worker/index.ts`) proxies `/api/auth/*` to `worker-auth` via a new `AUTH_SERVICE` service binding, so the browser only ever talks to the client's own origin. `worker-auth`'s `BETTER_AUTH_URL` moves from its own origin to the client's, since Better Auth uses that value to build the Google OAuth `redirect_uri` and to scope the session cookie. The React side gets a `better-auth/react` client for a `/login` route and a session-aware home page.

**Tech Stack:** Cloudflare Workers service bindings, Hono (unchanged, in `worker-auth` only), Better Auth (`better-auth/react` client, newly added to `worker-client`), TanStack Router file-based routes, Biome formatting (4-space indent, single quotes, no semicolons, no trailing commas, 140 col — run `biome check --write` if unsure, or rely on the pre-commit hook).

**Spec:** [docs/superpowers/specs/2026-08-27-client-auth-wiring-design.md](../specs/2026-08-27-client-auth-wiring-design.md)

## Global Constraints

- Service bindings are Worker-to-Worker only — the browser must never call `worker-auth` directly; every auth request goes through `worker-client`'s own origin.
- `better-auth` version in `worker-client` must match the `^1.7.1` pin already used in `worker-auth` (`apps/worker-auth/package.json`), for consistency across the two workers that share the Better Auth protocol.
- No new automated tests — this plan wires up already-tested behavior in `worker-auth` through a proxy; it introduces no new auth logic. Verification is via typecheck/build commands and manual dev-server checks, per the spec.
- Biome style: 4-space indent, single quotes, no semicolons, no trailing commas, `arrowParentheses: asNeeded` (no parens around a single arrow-function param).
- Branch: all work happens on `feature/client-auth-wiring` (already checked out), commits go there, not `dev`.

---

### Task 1: Service binding + proxy in `worker-client`

**Files:**
- Modify: `apps/worker-client/wrangler.jsonc`
- Modify: `apps/worker-client/worker/index.ts`
- Regenerate (do not hand-edit): `apps/worker-client/worker-configuration.d.ts`

**Interfaces:**
- Produces: `env.AUTH_SERVICE` — a Cloudflare `Fetcher` binding pointing at the `worker-auth` Worker, available to `worker/index.ts`'s `fetch` handler. Every later task that talks to `worker-auth` (browser-side, via `better-auth/react`) depends on this proxy being in place and correct, but no later task imports anything from this one directly — it's infrastructure, not a module.

- [ ] **Step 1: Add the service binding to `wrangler.jsonc`**

Replace the commented-out placeholder block:

```jsonc
    /**
     * Service Bindings (communicate between multiple Workers)
     * https://developers.cloudflare.com/workers/wrangler/configuration/#service-bindings
     */
    // "services": [  {   "binding": "MY_SERVICE",   "service": "my-service"  } ]
```

with:

```jsonc
    /**
     * Service Bindings (communicate between multiple Workers)
     * https://developers.cloudflare.com/workers/wrangler/configuration/#service-bindings
     */
    "services": [{ "binding": "AUTH_SERVICE", "service": "worker-auth" }]
```

- [ ] **Step 2: Regenerate Worker types**

Run: `npm run cf-typegen -w @capstone/client`

Expected: command exits 0 and rewrites `apps/worker-client/worker-configuration.d.ts`. Confirm the binding shows up (don't read the whole generated file — it's on the deny-read list):

Run: `grep -n "AUTH_SERVICE" apps/worker-client/worker-configuration.d.ts`

Expected: at least one match showing `AUTH_SERVICE: Fetcher` (or equivalent `Fetcher`-typed declaration) inside the `Env` interface.

- [ ] **Step 3: Update the passthrough worker to proxy `/api/auth/*`**

Replace the full contents of `apps/worker-client/worker/index.ts`:

```ts
export default {
    fetch(request, env) {
        const url = new URL(request.url)

        if (url.pathname.startsWith('/api/auth/')) {
            return env.AUTH_SERVICE.fetch(request)
        }

        return new Response(null, { status: 404 })
    }
} satisfies ExportedHandler<Env>
```

This drops the old hardcoded `{ name: 'Cloudflare' }` stub for other `/api/*` paths (nothing in the app depended on it — it was the unmodified Cloudflare Vite template default) in favor of a plain 404, consistent with there being no other `/api/*` route yet.

- [ ] **Step 4: Typecheck**

Run: `npm run build -w @capstone/client`

Expected: exits 0 (this runs `tsc -b && vite build`, which typechecks `worker/index.ts` against the regenerated `Env` type from Step 2 and confirms `env.AUTH_SERVICE.fetch` type-checks).

- [ ] **Step 5: Manual verification — proxy reaches `worker-auth`**

In one terminal, from the repo root: `npm run dev` (starts both `worker-client`'s `vite` dev server and `worker-auth`'s `wrangler dev`, plus `worker-realtime`, via Turborepo — leave it running).

In another terminal, once both dev servers report ready:

```bash
curl -s http://localhost:5173/api/auth/ok
```

Expected: `{"status":"ok"}` (or equivalent Better Auth health payload) — proves the request left the client's origin, crossed the `AUTH_SERVICE` binding, and got a real response back from `worker-auth`, all without the browser ever touching `worker-auth`'s own origin. If this instead 404s or times out, check that both dev processes are actually running and that the binding's `service` name (`worker-auth`) matches `apps/worker-auth/wrangler.jsonc`'s `name` field exactly.

- [ ] **Step 6: Commit**

```bash
git add apps/worker-client/wrangler.jsonc apps/worker-client/worker/index.ts apps/worker-client/worker-configuration.d.ts
git commit -m "feat(client): proxy /api/auth/* to worker-auth via service binding"
```

---

### Task 2: Point `worker-auth` at the client's origin

**Files:**
- Modify: `apps/worker-auth/.dev.vars` (gitignored, not committed)
- Modify: `apps/worker-auth/.dev.vars.example` (committed)

**Interfaces:**
- Produces: `worker-auth`'s `BETTER_AUTH_URL` env var now equals `http://localhost:5173` (the client's local origin) instead of `http://localhost:8787` (its own). Later tasks' end-to-end verification (Task 5) depends on this — without it, Google's `redirect_uri` would still point at the auth worker's own origin and the callback would never reach the client.

- [ ] **Step 1: Update `.dev.vars`**

In `apps/worker-auth/.dev.vars`, change the line:

```
BETTER_AUTH_URL=http://localhost:8787
```

to:

```
BETTER_AUTH_URL=http://localhost:5173
```

(Leave every other line in the file untouched — it holds real secrets that must not be printed or logged.)

- [ ] **Step 2: Update `.dev.vars.example`**

In `apps/worker-auth/.dev.vars.example`, make the identical change so the checked-in template documents the new convention:

```
BETTER_AUTH_URL=http://localhost:5173
```

- [ ] **Step 3: Verify the file was actually updated**

Run: `grep "^BETTER_AUTH_URL" apps/worker-auth/.dev.vars apps/worker-auth/.dev.vars.example`

Expected: both lines show `BETTER_AUTH_URL=http://localhost:5173`.

- [ ] **Step 4: Restart the auth dev server and re-check the proxy**

`wrangler dev` reads `.dev.vars` at startup, so if `npm run dev` was left running from Task 1, restart it (`Ctrl-C`, then `npm run dev` again) so `worker-auth` picks up the new `BETTER_AUTH_URL`. Then:

```bash
curl -s -i "http://localhost:5173/api/auth/sign-in/social?provider=google&callbackURL=/" | grep -i "^location:"
```

Expected: a `location:` header pointing at `accounts.google.com`'s OAuth authorization endpoint, whose `redirect_uri` query parameter is URL-encoded `http://localhost:5173/api/auth/callback/google` — i.e. the client's origin, not `localhost:8787`. This confirms `BETTER_AUTH_URL` is flowing through correctly end-to-end via the proxy.

- [ ] **Step 5: Commit**

`.dev.vars` is gitignored and won't be staged. Only the example file is tracked:

```bash
git add apps/worker-auth/.dev.vars.example
git commit -m "chore(auth): point BETTER_AUTH_URL at the client's local origin"
```

---

### Task 3: `better-auth/react` client in `worker-client`

**Files:**
- Modify: `apps/worker-client/package.json`
- Create: `apps/worker-client/src/lib/auth-client.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (this is a pure client-side addition; it works against the proxy set up in Task 1, but has no code dependency on it).
- Produces: `authClient` exported from `src/lib/auth-client.ts`, typed as `ReturnType<typeof createAuthClient>` from `better-auth/react` — exposes `authClient.signIn.social({ provider, callbackURL })`, `authClient.signOut()`, and the `authClient.useSession()` hook (returns `{ data, isPending, error }`, where `data` is `{ user: { email, ... }, session: {...} } | null`). Tasks 4 and 5 both import `authClient` from this file.

- [ ] **Step 1: Add the dependency**

In `apps/worker-client/package.json`, add to `dependencies` (matching the `^1.7.1` pin `apps/worker-auth/package.json` already uses):

```json
"better-auth": "^1.7.1",
```

Keep the existing dependencies alphabetically ordered alongside it (`@tanstack/react-router`, `@tanstack/react-router-devtools`, `better-auth`, `react`, `react-dom`).

- [ ] **Step 2: Install**

Run from the repo root: `npm install`

Expected: exits 0, `package-lock.json` updates to include `better-auth` and its transitive deps for the `@capstone/client` workspace. (Don't read `package-lock.json` back — it's on the deny-read list; `git diff --stat package-lock.json` is enough to confirm it changed.)

- [ ] **Step 3: Create the auth client**

Create `apps/worker-client/src/lib/auth-client.ts`:

```ts
import { createAuthClient } from 'better-auth/react'

export const authClient = createAuthClient()
```

No `baseURL` is needed — it defaults to `window.location.origin`, and Better Auth's default `basePath` (`/api/auth`) already matches what `worker/index.ts` proxies (Task 1).

- [ ] **Step 4: Typecheck**

Run: `npm run build -w @capstone/client`

Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add apps/worker-client/package.json package-lock.json apps/worker-client/src/lib/auth-client.ts
git commit -m "feat(client): add better-auth/react client"
```

---

### Task 4: `/login` route

**Files:**
- Create: `apps/worker-client/src/routes/login.tsx`

**Interfaces:**
- Consumes: `authClient` from `apps/worker-client/src/lib/auth-client.ts` (Task 3) — specifically `authClient.signIn.social({ provider, callbackURL })`.
- Produces: the `/login` route, linked to from `index.tsx` in Task 5.

- [ ] **Step 1: Create the route**

Create `apps/worker-client/src/routes/login.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { authClient } from '../lib/auth-client'

export const Route = createFileRoute('/login')({
    component: LoginRoute
})

function LoginRoute() {
    return (
        <div className="p-2">
            <h3>Sign in</h3>
            <button type="button" onClick={() => authClient.signIn.social({ provider: 'google', callbackURL: '/' })}>
                Sign in with Google
            </button>
        </div>
    )
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run build -w @capstone/client`

Expected: exits 0. (The TanStack Router Vite plugin regenerates `src/routeTree.gen.ts` to include the new `/login` route as part of this build — don't hand-edit that file.)

- [ ] **Step 3: Manual browser verification**

With `npm run dev` running (restart it if it isn't, so the regenerated route tree is picked up), open `http://localhost:5173/login` in a browser. Confirm the page renders a "Sign in" heading and a "Sign in with Google" button, and that clicking it redirects the browser toward `accounts.google.com`. Completing Google's actual consent screen with a real account is a separate manual check (Task 6) and requires a real Google Cloud OAuth client already configured for `worker-auth` — don't block this step on it.

- [ ] **Step 4: Commit**

```bash
git add apps/worker-client/src/routes/login.tsx apps/worker-client/src/routeTree.gen.ts
git commit -m "feat(client): add /login route"
```

---

### Task 5: Session-aware home page

**Files:**
- Modify: `apps/worker-client/src/routes/index.tsx`

**Interfaces:**
- Consumes: `authClient` from `apps/worker-client/src/lib/auth-client.ts` (Task 3), specifically `authClient.useSession()` (returns `{ data, isPending }`) and `authClient.signOut()`. Also links to the `/login` route from Task 4.
- Produces: nothing consumed by later tasks — this is the last code change.

- [ ] **Step 1: Update the route**

Replace the full contents of `apps/worker-client/src/routes/index.tsx`:

```tsx
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { authClient } from '../lib/auth-client'

export const Route = createFileRoute('/')({
    component: HomeRoute
})

function HomeRoute() {
    const navigate = useNavigate()
    const { data: session, isPending } = authClient.useSession()

    function createRoom() {
        const id = crypto.randomUUID()
        navigate({ from: '/', to: '/room', search: { id } })
    }

    return (
        <div className="p-2">
            <h3>Welcome!</h3>
            {!isPending &&
                (session ? (
                    <p>
                        Signed in as {session.user.email}{' '}
                        <button type="button" onClick={() => authClient.signOut()}>
                            Sign out
                        </button>
                    </p>
                ) : (
                    <p>
                        <Link to="/login">Sign in</Link>
                    </p>
                ))}
            <form>
                <div>
                    <label htmlFor="room-id">Join</label>
                    <input type="text" name="room-id" id="room-id" />
                    <button type="submit">Join</button>
                </div>
            </form>
            <br />
            <span>Create a new instan meeting</span>
            <button type="button" onClick={createRoom}>
                Create
            </button>
        </div>
    )
}
```

(Only the import line and the block right after `<h3>Welcome!</h3>` are new — the room create/join form is byte-for-byte unchanged from today.)

- [ ] **Step 2: Typecheck**

Run: `npm run build -w @capstone/client`

Expected: exits 0.

- [ ] **Step 3: Manual browser verification**

With `npm run dev` running, open `http://localhost:5173/`. Signed out, confirm it shows a "Sign in" link that navigates to `/login`. The room create/join UI below it should look and behave exactly as before this change.

- [ ] **Step 4: Commit**

```bash
git add apps/worker-client/src/routes/index.tsx
git commit -m "feat(client): show session state on the home page"
```

---

### Task 6: Docs + final manual sign-in check

**Files:**
- Modify: `apps/worker-client/CLAUDE.md`
- Modify: `apps/worker-auth/CLAUDE.md`

**Interfaces:** none — documentation only, no later tasks depend on this.

- [ ] **Step 1: Update `worker-client`'s CLAUDE.md**

In `apps/worker-client/CLAUDE.md`, replace the line:

```
No code here talks to `worker-realtime` yet — the two workers deploy independently with no service binding.
```

with:

```
`/api/auth/*` is proxied to `worker-auth` via the `AUTH_SERVICE` service binding (see `worker/index.ts`); `src/lib/auth-client.ts` holds the `better-auth/react` client the `/login` route and the home page use. No code here talks to `worker-realtime` yet — the two workers deploy independently with no service binding.
```

- [ ] **Step 2: Update `worker-auth`'s CLAUDE.md**

In `apps/worker-auth/CLAUDE.md`, replace the line:

```
No code here talks to `worker-client` or `worker-realtime` yet — this worker deploys independently.
```

with:

```
`worker-client` talks to this worker via a Cloudflare service binding (`AUTH_SERVICE` in `apps/worker-client/wrangler.jsonc`), proxying `/api/auth/*` requests through — see [docs/superpowers/specs/2026-08-27-client-auth-wiring-design.md](../../docs/superpowers/specs/2026-08-27-client-auth-wiring-design.md). `worker-realtime` is not wired up yet.
```

- [ ] **Step 3: Commit**

```bash
git add apps/worker-client/CLAUDE.md apps/worker-auth/CLAUDE.md
git commit -m "docs: note the client→auth service binding in both workspaces"
```

- [ ] **Step 4: Final manual check — real Google sign-in (not automatable)**

With `npm run dev` running and a real Google Cloud OAuth client already configured for `worker-auth` (per the auth worker's own spec, Testing step 8) whose authorized redirect URI is `http://localhost:5173/api/auth/callback/google`:

1. Open `http://localhost:5173/login` in a browser.
2. Click "Sign in with Google" and complete the real consent screen with a real Google account.
3. Confirm you land back on `http://localhost:5173/` and it shows "Signed in as `<your email>`".
4. Click "Sign out" and confirm the page goes back to showing the "Sign in" link.

If the redirect URI isn't yet registered for `http://localhost:5173/...` in the Google Cloud console, step 2 will fail with a `redirect_uri_mismatch` error from Google — update the OAuth client's authorized redirect URIs (outside this repo, per the spec's Non-goals) and retry.
