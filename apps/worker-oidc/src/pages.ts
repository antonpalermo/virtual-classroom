import type { Hono } from 'hono'
import { createAuth } from './auth'
import { createDb } from './db/client'

function escapeHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function loginPage(): string {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Sign in</title>
</head>
<body>
<h3>Sign in</h3>
<form id="login-form">
<label>Email <input type="email" name="email" required /></label>
<label>Password <input type="password" name="password" required /></label>
<button type="submit">Sign in</button>
</form>
<p id="error" style="color:red"></p>
<p><a id="signup-link" href="#">Need an account? Sign up</a></p>
<script>
document.getElementById('signup-link').href = '/signup' + window.location.search
document.getElementById('login-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    const form = new FormData(event.target)
    const response = await fetch('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: form.get('email'), password: form.get('password') })
    })
    if (!response.ok) {
        document.getElementById('error').textContent = 'Sign-in failed, please try again.'
        return
    }
    window.location.href = '/api/auth/oauth2/authorize' + window.location.search
})
</script>
</body>
</html>`
}

function signupPage(): string {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Sign up</title>
</head>
<body>
<h3>Sign up</h3>
<form id="signup-form">
<label>Name <input type="text" name="name" required /></label>
<label>Email <input type="email" name="email" required /></label>
<label>Password <input type="password" name="password" required /></label>
<button type="submit">Sign up</button>
</form>
<p id="error" style="color:red"></p>
<script>
document.getElementById('signup-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    const form = new FormData(event.target)
    const signUpResponse = await fetch('/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: form.get('name'), email: form.get('email'), password: form.get('password') })
    })
    if (!signUpResponse.ok) {
        document.getElementById('error').textContent = 'Sign-up failed, please try again.'
        return
    }
    const continueResponse = await fetch('/api/auth/oauth2/continue', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ created: true, oauth_query: window.location.search.slice(1) })
    })
    if (!continueResponse.ok) {
        document.getElementById('error').textContent = 'Could not continue sign-in, please try again.'
        return
    }
    const { url } = await continueResponse.json()
    window.location.href = url
})
</script>
</body>
</html>`
}

function consentPage(clientName: string, scope: string): string {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Authorize</title>
</head>
<body>
<h3>${escapeHtml(clientName)} wants to sign you in</h3>
<p>Requested access: ${escapeHtml(scope)}</p>
<button id="accept" type="button">Allow</button>
<button id="deny" type="button">Deny</button>
<p id="error" style="color:red"></p>
<script>
async function respond(accept) {
    const response = await fetch('/api/auth/oauth2/consent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accept, oauth_query: window.location.search.slice(1) })
    })
    if (!response.ok) {
        document.getElementById('error').textContent = 'Could not complete authorization, please try again.'
        return
    }
    const { url } = await response.json()
    window.location.href = url
}
document.getElementById('accept').addEventListener('click', () => respond(true))
document.getElementById('deny').addEventListener('click', () => respond(false))
</script>
</body>
</html>`
}

export function registerOidcPages(app: Hono<{ Bindings: Env }>) {
    app.get('/login', c => c.html(loginPage()))
    app.get('/signup', c => c.html(signupPage()))
    app.get('/consent', async c => {
        const clientId = c.req.query('client_id') ?? ''
        const scope = c.req.query('scope') ?? ''

        let clientName = clientId
        const db = createDb(c.env.OIDC_DB)
        const auth = createAuth(db, c.env)
        const client = await auth.api.getOAuthClientPublic({ query: { client_id: clientId }, headers: c.req.raw.headers }).catch(() => null)
        if (client?.client_name) clientName = client.client_name

        return c.html(consentPage(clientName, scope))
    })
}
