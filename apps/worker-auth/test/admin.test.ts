import { env } from 'cloudflare:workers'
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest'
import { callAsApp } from './helpers/call-app'
import { googleNetwork, mockGoogleAccount } from './helpers/google-network'

beforeAll(() => googleNetwork.enable())
afterEach(() => googleNetwork.resetHandlers())
afterAll(() => googleNetwork.disable())

async function signInWithGoogle(profile: { sub: string; email: string; name: string }) {
    mockGoogleAccount(profile)

    const authorizeResponse = await callAsApp(
        new Request('https://example.com/api/auth/sign-in/social', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ provider: 'google', callbackURL: 'https://example.com/' })
        })
    )
    const { url } = await authorizeResponse.json<{ url: string }>()
    if (!url) throw new Error('expected an authorize URL from /api/auth/sign-in/social')
    const state = new URL(url).searchParams.get('state')
    const stateCookie = authorizeResponse.headers.get('set-cookie')?.split(';')[0]
    if (!stateCookie) throw new Error('expected a state cookie from /api/auth/sign-in/social')

    const signInResponse = await callAsApp(
        new Request(`https://example.com/api/auth/callback/google?code=test-code&state=${state}`, {
            headers: { cookie: stateCookie }
        })
    )
    const cookie = signInResponse.headers
        .getSetCookie()
        .find(entry => entry.includes('session_token'))
        ?.split(';')[0]
    if (!cookie) throw new Error('expected a session cookie from sign-in')
    return cookie
}

async function userIdForEmail(email: string) {
    const { results } = await env.AUTH_DB.prepare('SELECT id FROM user WHERE email = ?').bind(email).all<{ id: string }>()
    const id = results[0]?.id
    if (!id) throw new Error(`expected a user row for ${email}`)
    return id
}

describe('admin plugin', () => {
    it('rejects a signed-in user who is not an admin', async ({ expect }) => {
        const cookie = await signInWithGoogle({ sub: 'google-10', email: 'nadia@example.com', name: 'Nadia' })

        const response = await callAsApp(new Request('https://example.com/api/auth/admin/list-users?limit=10', { headers: { cookie } }), {
            ADMIN_USER_IDS: ''
        })
        expect(response.status).toBe(403)
    })

    it('lets a user listed in ADMIN_USER_IDS call admin endpoints regardless of their role column', async ({ expect }) => {
        const cookie = await signInWithGoogle({ sub: 'google-11', email: 'omar@example.com', name: 'Omar' })
        const userId = await userIdForEmail('omar@example.com')

        const response = await callAsApp(new Request('https://example.com/api/auth/admin/list-users?limit=10', { headers: { cookie } }), {
            ADMIN_USER_IDS: userId
        })
        expect(response.status).toBe(200)
        const { users } = await response.json<{ users: { email: string }[] }>()
        expect(users.some(u => u.email === 'omar@example.com')).toBe(true)
    })

    it('lets a bootstrap admin promote another user, who can then call admin endpoints without being in ADMIN_USER_IDS', async ({
        expect
    }) => {
        const adminCookie = await signInWithGoogle({ sub: 'google-12', email: 'priya@example.com', name: 'Priya' })
        const adminId = await userIdForEmail('priya@example.com')

        const targetCookie = await signInWithGoogle({ sub: 'google-13', email: 'sam@example.com', name: 'Sam' })
        const targetId = await userIdForEmail('sam@example.com')

        const setRoleResponse = await callAsApp(
            new Request('https://example.com/api/auth/admin/set-role', {
                method: 'POST',
                headers: { cookie: adminCookie, origin: 'https://example.com', 'content-type': 'application/json' },
                body: JSON.stringify({ userId: targetId, role: 'admin' })
            }),
            { ADMIN_USER_IDS: adminId }
        )
        expect(setRoleResponse.status).toBe(200)

        // ADMIN_USER_IDS is empty here on purpose: this call must succeed only via the
        // promoted `role` column, not the bootstrap list.
        const response = await callAsApp(
            new Request('https://example.com/api/auth/admin/list-users?limit=10', { headers: { cookie: targetCookie } }),
            { ADMIN_USER_IDS: '' }
        )
        expect(response.status).toBe(200)
    })

    it('accepts a session presented as a bearer token instead of a cookie', async ({ expect }) => {
        mockGoogleAccount({ sub: 'google-14', email: 'theo@example.com', name: 'Theo' })

        const authorizeResponse = await callAsApp(
            new Request('https://example.com/api/auth/sign-in/social', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ provider: 'google', callbackURL: 'https://example.com/' })
            })
        )
        const { url } = await authorizeResponse.json<{ url: string }>()
        if (!url) throw new Error('expected an authorize URL from /api/auth/sign-in/social')
        const state = new URL(url).searchParams.get('state')
        const stateCookie = authorizeResponse.headers.get('set-cookie')?.split(';')[0]
        if (!stateCookie) throw new Error('expected a state cookie from /api/auth/sign-in/social')

        // The bearer plugin only mints a `set-auth-token` header on a response that itself sets
        // a *new* session cookie (its `after` hook, in
        // node_modules/better-auth/dist/plugins/bearer/index.mjs, reads
        // `responseHeaders.get('set-cookie')` and bails if absent) — a plain get-session call on
        // an already-fresh session doesn't reissue the cookie, so the token has to be read off
        // the sign-in callback response itself, not a later get-session call (confirmed by
        // instrumenting both responses: the callback carries `set-auth-token`, a follow-up
        // get-session doesn't).
        const signInResponse = await callAsApp(
            new Request(`https://example.com/api/auth/callback/google?code=test-code&state=${state}`, {
                headers: { cookie: stateCookie }
            })
        )
        const token = signInResponse.headers.get('set-auth-token')
        if (!token) throw new Error('expected a set-auth-token header from the bearer plugin')

        const bearerResponse = await callAsApp(
            new Request('https://example.com/api/auth/get-session', { headers: { authorization: `Bearer ${token}` } })
        )
        const session = await bearerResponse.json<{ user: { email: string } }>()
        expect(session.user.email).toBe('theo@example.com')
    })

    it('lets a manager list users, change a non-admin role, ban/unban, and remove a non-admin', async ({ expect }) => {
        const managerCookie = await signInWithGoogle({ sub: 'google-20', email: 'mia@example.com', name: 'Mia' })
        const managerId = await userIdForEmail('mia@example.com')
        await callAsApp(
            new Request('https://example.com/api/auth/admin/set-role', {
                method: 'POST',
                headers: { cookie: managerCookie, origin: 'https://example.com', 'content-type': 'application/json' },
                body: JSON.stringify({ userId: managerId, role: 'manager' })
            }),
            { ADMIN_USER_IDS: managerId }
        )
        // re-sign-in so the session reflects the freshly-set role
        const freshManagerCookie = await signInWithGoogle({ sub: 'google-20', email: 'mia@example.com', name: 'Mia' })

        await signInWithGoogle({ sub: 'google-21', email: 'noah@example.com', name: 'Noah' })
        const targetId = await userIdForEmail('noah@example.com')

        const listResponse = await callAsApp(
            new Request('https://example.com/api/auth/admin/list-users?limit=10', { headers: { cookie: freshManagerCookie } }),
            { ADMIN_USER_IDS: '' }
        )
        expect(listResponse.status).toBe(200)
        const { users } = await listResponse.json<{ users: { email: string }[] }>()
        expect(users.some(u => u.email === 'noah@example.com')).toBe(true)

        const setRoleResponse = await callAsApp(
            new Request('https://example.com/api/auth/admin/set-role', {
                method: 'POST',
                headers: { cookie: freshManagerCookie, origin: 'https://example.com', 'content-type': 'application/json' },
                body: JSON.stringify({ userId: targetId, role: 'manager' })
            }),
            { ADMIN_USER_IDS: '' }
        )
        expect(setRoleResponse.status).toBe(200)

        const banResponse = await callAsApp(
            new Request('https://example.com/api/auth/admin/ban-user', {
                method: 'POST',
                headers: { cookie: freshManagerCookie, origin: 'https://example.com', 'content-type': 'application/json' },
                body: JSON.stringify({ userId: targetId })
            }),
            { ADMIN_USER_IDS: '' }
        )
        expect(banResponse.status).toBe(200)

        const unbanResponse = await callAsApp(
            new Request('https://example.com/api/auth/admin/unban-user', {
                method: 'POST',
                headers: { cookie: freshManagerCookie, origin: 'https://example.com', 'content-type': 'application/json' },
                body: JSON.stringify({ userId: targetId })
            }),
            { ADMIN_USER_IDS: '' }
        )
        expect(unbanResponse.status).toBe(200)

        const removeResponse = await callAsApp(
            new Request('https://example.com/api/auth/admin/remove-user', {
                method: 'POST',
                headers: { cookie: freshManagerCookie, origin: 'https://example.com', 'content-type': 'application/json' },
                body: JSON.stringify({ userId: targetId })
            }),
            { ADMIN_USER_IDS: '' }
        )
        expect(removeResponse.status).toBe(200)
        const { success } = await removeResponse.json<{ success: boolean }>()
        expect(success).toBe(true)
    })

    it('rejects a plain user on every admin endpoint', async ({ expect }) => {
        const cookie = await signInWithGoogle({ sub: 'google-22', email: 'zara@example.com', name: 'Zara' })

        const listResponse = await callAsApp(
            new Request('https://example.com/api/auth/admin/list-users?limit=10', { headers: { cookie } }),
            { ADMIN_USER_IDS: '' }
        )
        expect(listResponse.status).toBe(403)

        const setRoleResponse = await callAsApp(
            new Request('https://example.com/api/auth/admin/set-role', {
                method: 'POST',
                headers: { cookie, origin: 'https://example.com', 'content-type': 'application/json' },
                body: JSON.stringify({ userId: 'irrelevant', role: 'manager' })
            }),
            { ADMIN_USER_IDS: '' }
        )
        expect(setRoleResponse.status).toBe(403)

        const banResponse = await callAsApp(
            new Request('https://example.com/api/auth/admin/ban-user', {
                method: 'POST',
                headers: { cookie, origin: 'https://example.com', 'content-type': 'application/json' },
                body: JSON.stringify({ userId: 'irrelevant' })
            }),
            { ADMIN_USER_IDS: '' }
        )
        expect(banResponse.status).toBe(403)
    })
})
