import type { Context, Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { isAllowedReturnTo, parseAllowedReturnOrigins } from './allowed-return-origins'
import { createAuth } from './auth'
import { createDb } from './db/client'

// Better Auth's bearer plugin treats the session cookie's own value as the bearer token
// (node_modules/better-auth/dist/plugins/bearer/index.mjs: `const token = sessionCookie.value`),
// so the value to relay forward comes straight off this request's own Cookie header rather than
// a query param an attacker could substitute their own token into (session fixation). Matched by
// exact cookie name (via Hono's own cookie parser) rather than a substring match — a substring
// match would accept any cookie whose name *or value* happens to contain "session_token",
// including one an attacker plants on a sibling subdomain, reopening the same session-fixation
// class of bug fixed above.
function extractSessionToken(c: Context): string | undefined {
    return getCookie(c, 'better-auth.session_token') ?? getCookie(c, '__Secure-better-auth.session_token')
}

function loginPage(completeUrl: string): string {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Sign in</title>
</head>
<body>
<h3>Sign in</h3>
<button id="google-sign-in" type="button">Sign in with Google</button>
<script>
document.getElementById('google-sign-in').addEventListener('click', async () => {
    const response = await fetch('/api/auth/sign-in/social', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'google', callbackURL: ${JSON.stringify(completeUrl)} })
    })
    const { url } = await response.json()
    if (!url) {
        alert('Sign-in failed, please try again.')
        return
    }
    window.location.href = url
})
</script>
</body>
</html>`
}

export function registerHostedLogin(app: Hono<{ Bindings: Env }>) {
    app.get('/login', c => {
        const returnTo = c.req.query('returnTo')
        const allowedOrigins = parseAllowedReturnOrigins(c.env)
        if (!returnTo || !isAllowedReturnTo(returnTo, allowedOrigins)) {
            return c.text('Unrecognized returnTo', 400)
        }
        const completeUrl = `/login/complete?returnTo=${encodeURIComponent(returnTo)}`
        return c.html(loginPage(completeUrl))
    })

    app.get('/login/complete', async c => {
        const returnTo = c.req.query('returnTo')
        const allowedOrigins = parseAllowedReturnOrigins(c.env)
        if (!returnTo || !isAllowedReturnTo(returnTo, allowedOrigins)) {
            return c.text('Unrecognized returnTo', 400)
        }

        const sessionToken = extractSessionToken(c)
        if (!sessionToken) {
            return c.text('Unable to establish session', 401)
        }

        const db = createDb(c.env.AUTH_DB)
        const auth = createAuth(db, c.env)
        const tokenResponse = await auth.handler(
            new Request(new URL('/api/auth/token', c.req.url), {
                headers: { cookie: c.req.header('cookie') ?? '' }
            })
        )
        if (!tokenResponse.ok) {
            return c.text('Unable to establish session', 401)
        }
        const { token: jwt } = await tokenResponse.json<{ token: string }>()
        if (!jwt || typeof jwt !== 'string') {
            return c.text('Unable to establish session', 401)
        }

        const redirectUrl = new URL(returnTo)
        redirectUrl.hash = `token=${encodeURIComponent(jwt)}&session=${encodeURIComponent(sessionToken)}`
        return c.redirect(redirectUrl.toString(), 302)
    })
}
