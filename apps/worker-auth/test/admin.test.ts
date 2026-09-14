import { env } from 'cloudflare:workers'
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest'
import { callAsApp } from './helpers/call-app'
import { googleNetwork, mockGoogleAccount } from './helpers/google-network'

beforeAll(() => googleNetwork.enable())
afterEach(() => googleNetwork.resetHandlers())
afterAll(() => googleNetwork.disable())

// The bearer plugin only mints a `set-auth-token` header on a response that itself sets a *new*
// session cookie (its `after` hook, in node_modules/better-auth/dist/plugins/bearer/index.mjs,
// reads `responseHeaders.get('set-cookie')` and bails if absent) — so the token has to be read
// off the sign-in callback response itself, not a later get-session call.
async function googleSignIn(profile: { sub: string; email: string; name: string }) {
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
    return { cookie, token: signInResponse.headers.get('set-auth-token') }
}

async function signInWithGoogle(profile: { sub: string; email: string; name: string }) {
    return (await googleSignIn(profile)).cookie
}

async function signInForBearerToken(profile: { sub: string; email: string; name: string }) {
    const { token } = await googleSignIn(profile)
    if (!token) throw new Error('expected a set-auth-token header from the bearer plugin')
    return token
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
        const token = await signInForBearerToken({ sub: 'google-14', email: 'theo@example.com', name: 'Theo' })

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

async function setRole(actorCookie: string, targetUserId: string, role: string, adminUserIds = '') {
    return callAsApp(
        new Request('https://example.com/api/auth/admin/set-role', {
            method: 'POST',
            headers: { cookie: actorCookie, origin: 'https://example.com', 'content-type': 'application/json' },
            body: JSON.stringify({ userId: targetUserId, role })
        }),
        { ADMIN_USER_IDS: adminUserIds }
    )
}

it('rejects a manager trying to grant the admin role', async ({ expect }) => {
    const bootstrapCookie = await signInWithGoogle({ sub: 'google-30', email: 'lena@example.com', name: 'Lena' })
    const bootstrapId = await userIdForEmail('lena@example.com')
    await setRole(bootstrapCookie, bootstrapId, 'manager', bootstrapId)
    const managerCookie = await signInWithGoogle({ sub: 'google-30', email: 'lena@example.com', name: 'Lena' })

    await signInWithGoogle({ sub: 'google-31', email: 'omar2@example.com', name: 'Omar' })
    const targetId = await userIdForEmail('omar2@example.com')

    const response = await setRole(managerCookie, targetId, 'admin')
    expect(response.status).toBe(403)
})

it('rejects a manager acting on a user who is currently admin', async ({ expect }) => {
    const adminCookie = await signInWithGoogle({ sub: 'google-32', email: 'wei@example.com', name: 'Wei' })
    const adminId = await userIdForEmail('wei@example.com')
    // Bootstrap admin status (ADMIN_USER_IDS) is per-request and isn't reflected in the `role`
    // column, which is the only signal manager-restrictions can check — persist it so wei is
    // "currently admin" for the later calls below.
    await setRole(adminCookie, adminId, 'admin', adminId)

    await signInWithGoogle({ sub: 'google-33', email: 'ana@example.com', name: 'Ana' })
    const managerId = await userIdForEmail('ana@example.com')
    await setRole(adminCookie, managerId, 'manager', adminId)
    const freshManagerCookie = await signInWithGoogle({ sub: 'google-33', email: 'ana@example.com', name: 'Ana' })

    const response = await setRole(freshManagerCookie, adminId, 'manager', '')
    expect(response.status).toBe(403)

    const banResponse = await callAsApp(
        new Request('https://example.com/api/auth/admin/ban-user', {
            method: 'POST',
            headers: { cookie: freshManagerCookie, origin: 'https://example.com', 'content-type': 'application/json' },
            body: JSON.stringify({ userId: adminId })
        }),
        { ADMIN_USER_IDS: '' }
    )
    expect(banResponse.status).toBe(403)
})

it('still lets an admin act on another admin', async ({ expect }) => {
    const adminCookie = await signInWithGoogle({ sub: 'google-34', email: 'tom@example.com', name: 'Tom' })
    const adminId = await userIdForEmail('tom@example.com')

    await signInWithGoogle({ sub: 'google-35', email: 'ivy@example.com', name: 'Ivy' })
    const otherAdminId = await userIdForEmail('ivy@example.com')
    await setRole(adminCookie, otherAdminId, 'admin', adminId)

    const response = await setRole(adminCookie, otherAdminId, 'manager', adminId)
    expect(response.status).toBe(200)
})

// worker-admin authenticates exclusively by bearer token, never a cookie. `runBeforeHooks`
// (node_modules/better-auth/dist/api/dispatch.mjs) hands every `hooks.before` entry the same
// unmodified context and only merges returned headers after the loop, so `bearer()`'s
// header→cookie conversion is invisible to manager-restrictions' own hook — these cases all
// passed unrestricted until manager-restrictions ran bearer's conversion itself.
describe('manager restrictions over bearer auth', () => {
    function adminPost(path: string, token: string, body: unknown, adminUserIds = '') {
        return callAsApp(
            new Request(`https://example.com/api/auth/admin/${path}`, {
                method: 'POST',
                headers: { authorization: `Bearer ${token}`, origin: 'https://example.com', 'content-type': 'application/json' },
                body: JSON.stringify(body)
            }),
            { ADMIN_USER_IDS: adminUserIds }
        )
    }

    // Promotes `profile` to `role` using its own bootstrap admin rights, then re-signs-in so the
    // returned token belongs to a session whose row already carries the new role.
    async function bearerTokenForRole(profile: { sub: string; email: string; name: string }, role: string) {
        await signInForBearerToken(profile)
        const userId = await userIdForEmail(profile.email)
        const bootstrapToken = await signInForBearerToken(profile)
        const promote = await adminPost('set-role', bootstrapToken, { userId, role }, userId)
        if (promote.status !== 200) throw new Error(`failed to promote ${profile.email} to ${role}: ${promote.status}`)
        return { token: await signInForBearerToken(profile), userId }
    }

    it('rejects a manager granting the admin role via set-role', async ({ expect }) => {
        const { token } = await bearerTokenForRole({ sub: 'google-40', email: 'bea@example.com', name: 'Bea' }, 'manager')
        await signInWithGoogle({ sub: 'google-41', email: 'cal@example.com', name: 'Cal' })
        const targetId = await userIdForEmail('cal@example.com')

        const response = await adminPost('set-role', token, { userId: targetId, role: 'admin' })
        expect(response.status).toBe(403)
    })

    it('rejects a manager granting the admin role as a single-element array', async ({ expect }) => {
        const { token } = await bearerTokenForRole({ sub: 'google-42', email: 'dev@example.com', name: 'Dev' }, 'manager')
        await signInWithGoogle({ sub: 'google-43', email: 'eve@example.com', name: 'Eve' })
        const targetId = await userIdForEmail('eve@example.com')

        const response = await adminPost('set-role', token, { userId: targetId, role: ['admin'] })
        expect(response.status).toBe(403)
    })

    it('rejects a manager acting on an admin target via ban-user', async ({ expect }) => {
        const { token: adminToken } = await bearerTokenForRole({ sub: 'google-44', email: 'fay@example.com', name: 'Fay' }, 'admin')
        const adminId = await userIdForEmail('fay@example.com')
        await signInWithGoogle({ sub: 'google-45', email: 'gus@example.com', name: 'Gus' })
        const managerId = await userIdForEmail('gus@example.com')
        expect((await adminPost('set-role', adminToken, { userId: managerId, role: 'manager' })).status).toBe(200)
        const managerToken = await signInForBearerToken({ sub: 'google-45', email: 'gus@example.com', name: 'Gus' })

        const response = await adminPost('ban-user', managerToken, { userId: adminId })
        expect(response.status).toBe(403)
    })

    it('keeps a manager restricted after self-assigning a comma-joined role', async ({ expect }) => {
        const { token, userId } = await bearerTokenForRole({ sub: 'google-46', email: 'hal@example.com', name: 'Hal' }, 'manager')
        await signInWithGoogle({ sub: 'google-47', email: 'ivy2@example.com', name: 'Ivy' })
        const targetId = await userIdForEmail('ivy2@example.com')

        // `parseRoles` (node_modules/better-auth/dist/plugins/admin/routes.mjs) persists this as
        // the literal string 'manager,user', which `hasPermission` still authorizes as a manager
        // by splitting on ','. A `role === 'manager'` actor check would stop matching here and
        // wave every later request through.
        const selfPromote = await adminPost('set-role', token, { userId, role: ['manager', 'user'] })
        expect(selfPromote.status).toBe(200)
        const { results } = await env.AUTH_DB.prepare('SELECT role FROM user WHERE id = ?').bind(userId).all<{ role: string }>()
        expect(results[0]?.role).toBe('manager,user')

        const freshToken = await signInForBearerToken({ sub: 'google-46', email: 'hal@example.com', name: 'Hal' })
        const response = await adminPost('set-role', freshToken, { userId: targetId, role: 'admin' })
        expect(response.status).toBe(403)
    })

    it('rejects a manager granting the admin role via update-user', async ({ expect }) => {
        const { token } = await bearerTokenForRole({ sub: 'google-48', email: 'jon@example.com', name: 'Jon' }, 'manager')
        await signInWithGoogle({ sub: 'google-49', email: 'kim@example.com', name: 'Kim' })
        const targetId = await userIdForEmail('kim@example.com')

        const response = await adminPost('update-user', token, { userId: targetId, data: { role: 'admin' } })
        expect(response.status).toBe(403)
    })

    it('rejects a manager creating a brand-new admin via create-user', async ({ expect }) => {
        const { token } = await bearerTokenForRole({ sub: 'google-50', email: 'lou@example.com', name: 'Lou' }, 'manager')

        const response = await adminPost('create-user', token, { email: 'newadmin@example.com', name: 'New', role: 'admin' })
        expect(response.status).toBe(403)
    })

    it('leaves a real admin unaffected on every restricted endpoint over bearer auth', async ({ expect }) => {
        const { token } = await bearerTokenForRole({ sub: 'google-51', email: 'mac@example.com', name: 'Mac' }, 'admin')
        await signInWithGoogle({ sub: 'google-52', email: 'nia@example.com', name: 'Nia' })
        const targetId = await userIdForEmail('nia@example.com')

        // ADMIN_USER_IDS stays empty: these must pass on the persisted `role` column alone.
        expect((await adminPost('set-role', token, { userId: targetId, role: 'admin' })).status).toBe(200)
        expect((await adminPost('update-user', token, { userId: targetId, data: { role: 'admin' } })).status).toBe(200)
        expect((await adminPost('ban-user', token, { userId: targetId })).status).toBe(200)
        expect((await adminPost('unban-user', token, { userId: targetId })).status).toBe(200)
        expect((await adminPost('create-user', token, { email: 'madeadmin@example.com', name: 'Made', role: 'admin' })).status).toBe(200)
        expect((await adminPost('remove-user', token, { userId: targetId })).status).toBe(200)
    })
})

// manager-restrictions' hook populates `ctx.context.session`, which the endpoint's own session
// lookup then reuses — so its bearer conversion must be no more permissive than bearer()'s.
// A token whose HMAC signature doesn't check out must still authenticate nobody: `getSignedCookie`
// (node_modules/better-call/dist/context.mjs) verifies the signature when the cookie is read
// back, which is what makes reusing bearer()'s own handler safe here.
it('does not authenticate a bearer token with a forged signature', async ({ expect }) => {
    const token = await signInForBearerToken({ sub: 'google-53', email: 'oli@example.com', name: 'Oli' })
    const userId = await userIdForEmail('oli@example.com')
    const [value] = decodeURIComponent(token).split('.')
    const forged = encodeURIComponent(`${value}.${'A'.repeat(43)}=`)

    const response = await callAsApp(
        new Request('https://example.com/api/auth/admin/set-role', {
            method: 'POST',
            headers: { authorization: `Bearer ${forged}`, origin: 'https://example.com', 'content-type': 'application/json' },
            body: JSON.stringify({ userId, role: 'admin' })
        }),
        { ADMIN_USER_IDS: '' }
    )
    expect(response.status).toBe(401)
})
