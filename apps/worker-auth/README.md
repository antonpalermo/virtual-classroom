# @capstone/auth

The original identity worker: Google sign-in/sign-up via Better Auth on D1, plus Better Auth's `oauthProvider` plugin so other apps can link in as OAuth clients. It also serves a hosted `/login` page that redirects back with a JWT.

No app signs in through it any more; `worker-client` and `worker-admin` use `worker-oidc`.

```sh
npm run dev
npm run typegen
npm run deploy
npm run test:run
```

See [CLAUDE.md](CLAUDE.md) for details.
