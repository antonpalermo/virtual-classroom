// After a successful sign-in, `prompt=login`/`create` has already been satisfied. Better Auth's
// authorize handler re-checks the literal `prompt` query param on every call with no memory of
// having already shown the login page for this attempt — so resuming /api/auth/oauth2/authorize
// with `prompt` still present bounces straight back to /login, forever (confirmed live: this is
// exactly what login.tsx's handleSubmit and GoogleButton.tsx's success callbackURL were doing).
//
// Only safe to use on a URL headed straight back to /api/auth/oauth2/authorize (that re-entry
// doesn't verify a signature). NEVER strip `prompt` from a signed `oauth_query` body field sent to
// /sign-in/social or /public-client-prelogin — Better Auth verifies that blob byte-for-byte against
// its own signature and rejects a mismatch with invalid_signature (confirmed live).
export function buildAuthorizeResumeQuery(oauthQuery: string): string {
    const params = new URLSearchParams(oauthQuery)
    params.delete('error')
    params.delete('error_description')
    params.delete('prompt')
    return params.toString()
}
