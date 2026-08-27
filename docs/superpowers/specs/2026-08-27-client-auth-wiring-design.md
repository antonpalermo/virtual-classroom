# Client → Auth Wiring Design

## Context

`apps/worker-auth` (`@capstone/auth`) exists and works standalone: Google sign-in/sign-up via Better Auth, backed by D1. Its own design spec ([2026-08-26-auth-worker-design.md](2026-08-26-auth-worker-design.md)) explicitly deferred "wiring up `worker-client` or `worker-realtime` as consumers" to a follow-up spec. This is that follow-up, scoped to `worker-client` only.

Today `apps/worker-client` has no code that talks to any other worker in the repo, and no login page.

## Goal

Connect `worker-client` to `worker-auth` and add a minimal login page, using a Cloudflare service binding rather than direct browser-to-auth CORS calls, so the auth session cookie stays first-party to the client app. Keep the login page itself as bare as possible — no visual design pass, just a working Google sign-in.

## Non-goals (explicitly deferred)

- Wiring up `worker-realtime` as a consumer — separate future work.
- Gating any existing feature (room create/join) behind authentication.
- Roles/permissions enforcement — `user.role` already exists as a placeholder field but nothing reads it yet.
- Production deploy config (setting `BETTER_AUTH_URL` and any related secrets for the deployed client origin, updating the Google Cloud OAuth client's redirect URI for production) — this spec covers local dev wiring; deploying is a manual follow-up step outside repo scope, same treatment the auth worker spec gives Google Cloud console config.
- Any new automated tests. This is wiring existing, already-tested auth behavior through a proxy — no new auth logic is introduced.

## Architecture

Cloudflare service bindings are Worker-to-Worker only — a browser cannot call one directly. So the browser keeps talking only to `worker-client`'s own origin; `worker-client`'s existing passthrough worker forwards the relevant requests server-side to `worker-auth` over a service binding:

- `apps/worker-client/wrangler.jsonc` gets a new `services` entry: `{ "binding": "AUTH_SERVICE", "service": "worker-auth" }`.
- `apps/worker-client/worker/index.ts` forwards any request under `/api/auth/*` to `env.AUTH_SERVICE.fetch(request)` — Better Auth's own mount path (`/api/auth/*`), unchanged. Everything else under `/api/*` continues to 404 (this also removes the current template's hardcoded `{ name: 'Cloudflare' }` stub response, which nothing depends on).
- Because the response the browser sees comes back through the client's own origin, Better Auth's session cookie is set as first-party to the client — no CORS configuration needed anywhere, and no third-party cookie restrictions apply.
- `worker-auth`'s `BETTER_AUTH_URL` (currently its own `http://localhost:8787` for local dev) changes to the client's public origin (`http://localhost:5173` for local dev). Better Auth uses `baseURL` both to build the `redirect_uri` it sends Google and to scope the session cookie — it must match the origin the browser actually sees, which is now the client's, not the auth worker's own.

**Local dev.** `worker-client`'s dev command (`vite`, via `@cloudflare/vite-plugin`) and `worker-auth`'s dev command (`wrangler dev`) both run on Miniflare and participate in Wrangler's local service-binding registry, which lets separately-started dev processes discover each other by worker name (`service: "worker-auth"` in the binding config resolves to whichever local `worker-auth` dev session is running). No extra orchestration beyond `npm run dev` at the repo root, which already runs both via Turborepo in parallel.

## Components

- **`apps/worker-auth`** — no code changes. `.dev.vars`'s `BETTER_AUTH_URL` changes from its own origin to the client's local origin; `.dev.vars.example` gets the same update so the convention is documented for other environments.
- **`apps/worker-client/wrangler.jsonc`** — add the `AUTH_SERVICE` service binding. Run `cf-typegen` (`wrangler types`) afterward so `Env.AUTH_SERVICE` (typed as `Fetcher`) shows up in the generated `worker-configuration.d.ts`.
- **`apps/worker-client/worker/index.ts`** — proxy `/api/auth/*` to `AUTH_SERVICE`, gains an `env` parameter it didn't need before.
- **`apps/worker-client/package.json`** — add `better-auth` as a dependency (its `better-auth/react` client entry point).
- **`apps/worker-client/src/lib/auth-client.ts`** (new) — `createAuthClient()` from `better-auth/react`, exported for use by routes. Default config works since the client is now same-origin with `/api/auth`.
- **`apps/worker-client/src/routes/login.tsx`** (new) — one route, one "Sign in with Google" button calling `authClient.signIn.social({ provider: 'google', callbackURL: '/' })`. No styling beyond what's already inline-consistent with `index.tsx`/`room.tsx`.
- **`apps/worker-client/src/routes/index.tsx`** — use `authClient.useSession()`: show "Signed in as {email}" plus a sign-out button when authenticated, otherwise a link to `/login`. Existing room create/join markup is untouched.
- **`apps/worker-client/CLAUDE.md`** / **`apps/worker-auth/CLAUDE.md`** — update the "no code here talks to worker-client/worker-auth yet" lines to describe the new service binding.

## Data flow

1. Browser loads `/login` from `worker-client`, clicks "Sign in with Google."
2. `authClient` issues a request to `/api/auth/sign-in/social?provider=google&callbackURL=/` against the client's own origin.
3. `worker-client`'s passthrough worker matches `/api/auth/*` and forwards the request via `AUTH_SERVICE.fetch()` to `worker-auth`.
4. `worker-auth`'s Better Auth handler responds with a redirect to Google's consent screen; that response flows back through the client's origin unchanged, so the browser follows it as if the client itself issued it.
5. Google redirects back to `BETTER_AUTH_URL + /api/auth/callback/google` — now the client's origin — which the client's worker again proxies to `worker-auth` for the token exchange, session creation, and `Set-Cookie`.
6. Browser lands back on `/` (the configured `callbackURL`) with a session cookie scoped to the client's own origin. `index.tsx`'s `useSession()` picks it up and renders the signed-in state.

## Error handling

No new error handling is introduced — Better Auth's handler already produces its own error responses (bad callback, denied consent, etc.), and the proxy forwards them byte-for-byte since it's a plain `fetch()` pass-through. The one failure mode worth naming explicitly: if the Google Cloud OAuth client's authorized redirect URI isn't updated to match the client's origin, Google will reject the callback with a `redirect_uri_mismatch` error — this is a manual, outside-repo-scope config step (see Non-goals), not something the code can validate.

## Testing / verification

No new automated tests — this spec adds no new auth behavior, only a proxy path in front of already-tested behavior in `worker-auth`. Verification is manual, run via `npm run dev`:

1. Confirm `/login` renders with a working sign-in button.
2. Confirm clicking it produces a request that, when inspected (e.g. via `curl -i` against `/api/auth/sign-in/social?provider=google`), returns a redirect toward Google's real authorization endpoint with the expected `client_id`/`redirect_uri` — proving the service-binding proxy and `BETTER_AUTH_URL` change work end-to-end up to Google's door.
3. The remaining leg — actually completing Google's consent screen with a real account — stays a manual, one-time developer check, same as the auth worker's own spec.
