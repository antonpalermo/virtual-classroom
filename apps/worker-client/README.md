# @capstone/client

The student/teacher-facing frontend of the virtual classroom. A React 19 + TanStack Router SPA built with Vite and served as static assets from a Cloudflare Worker.

- Signs users in against `worker-oidc` as a public OAuth client (Authorization Code + PKCE, straight from the browser).
- Hosts the room UI that connects to `worker-realtime` for signaling.
- Verifies stored tokens locally with `@capstone/auth-verify`; UI comes from `@capstone/ui`.

```sh
npm run dev      # vite dev server
npm run build    # production build
npm run deploy   # deploy to Cloudflare
npm run test:run # tests
```

See [CLAUDE.md](CLAUDE.md) for layout and details.
