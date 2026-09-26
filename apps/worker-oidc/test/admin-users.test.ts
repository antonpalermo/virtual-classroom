import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { describe, it } from 'vitest'
import { createDb } from '../worker/db/client.js'
import { invite, user } from '../worker/db/schema.js'
import { callAsApp } from './helpers/call-app.js'
import { seedUser, signInForTokens } from './helpers/sign-in.js'

async function adminToken(email = 'admin@example.com') {
    await seedUser(email, 'correct-horse-battery', { role: 'admin' })
    const { id_token } = await signInForTokens(email, 'correct-horse-battery')
    return id_token
}

function call(path: string, token?: string, init: RequestInit = {}) {
    return callAsApp(
        new Request(`https://example.com${path}`, {
            ...init,
            headers: { ...(init.headers ?? {}), ...(token ? { authorization: `Bearer ${token}` } : {}) }
        })
    )
}

describe('admin user-management API', () => {
    it('rejects every route with no Authorization header', async ({ expect }) => {
        const response = await call('/api/admin/users')
        expect(response.status).toBe(401)
    })

    it('rejects every route with a garbage bearer token', async ({ expect }) => {
        const response = await call('/api/admin/users', 'not-a-real-token')
        expect(response.status).toBe(401)
    })

    it('rejects a valid token belonging to a non-admin user', async ({ expect }) => {
        await seedUser('plain-user@example.com', 'correct-horse-battery')
        const { id_token } = await signInForTokens('plain-user@example.com', 'correct-horse-battery')
        const response = await call('/api/admin/users', id_token)
        expect(response.status).toBe(403)
    })

    it('lists users for an admin caller', async ({ expect }) => {
        const token = await adminToken('list-admin@example.com')
        const response = await call('/api/admin/users', token)
        expect(response.status).toBe(200)
        const { users } = await response.json<{ users: Array<{ email: string; role: string }> }>()
        expect(users.some(u => u.email === 'list-admin@example.com')).toBe(true)
    })

    it('creates a user and returns an invite link backed by a real invite row', async ({ expect }) => {
        const token = await adminToken('creator-admin@example.com')
        const response = await call('/api/admin/users', token, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'New Person', email: 'invitee@example.com' })
        })
        expect(response.status).toBe(200)
        const { user: createdUser, inviteUrl } = await response.json<{ user: { id: string; email: string }; inviteUrl: string }>()
        expect(createdUser.email).toBe('invitee@example.com')
        expect(inviteUrl).toContain('/accept-invite?token=')

        const token_ = new URL(inviteUrl).searchParams.get('token')
        const db = createDb(env.OIDC_DB)
        const [row] = await db
            .select()
            .from(invite)
            .where(eq(invite.token, token_ ?? ''))
            .limit(1)
        expect(row?.userId).toBe(createdUser.id)
        expect(row?.usedAt).toBeNull()
    })

    it('rejects creating a user with an email that already exists', async ({ expect }) => {
        const token = await adminToken('dup-admin@example.com')
        const response = await call('/api/admin/users', token, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'Dup', email: 'dup-admin@example.com' })
        })
        expect(response.status).toBe(409)
    })

    it("edits a user's name/email/role", async ({ expect }) => {
        const token = await adminToken('editor-admin@example.com')
        const targetId = await seedUser('editable@example.com', 'correct-horse-battery')
        const response = await call(`/api/admin/users/${targetId}`, token, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'Renamed', role: 'admin' })
        })
        expect(response.status).toBe(200)

        const db = createDb(env.OIDC_DB)
        const [row] = await db.select().from(user).where(eq(user.id, targetId)).limit(1)
        expect(row?.name).toBe('Renamed')
        expect(row?.role).toBe('admin')
    })

    it('rejects an unknown role value on edit', async ({ expect }) => {
        const token = await adminToken('bad-role-admin@example.com')
        const targetId = await seedUser('bad-role-target@example.com', 'correct-horse-battery')
        const response = await call(`/api/admin/users/${targetId}`, token, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ role: 'superuser' })
        })
        expect(response.status).toBe(400)
    })

    it("rejects editing a user's email to one that belongs to a different user", async ({ expect }) => {
        const token = await adminToken('email-conflict-admin@example.com')
        await seedUser('taken@example.com', 'correct-horse-battery')
        const targetId = await seedUser('editable-email@example.com', 'correct-horse-battery')

        const response = await call(`/api/admin/users/${targetId}`, token, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: 'taken@example.com' })
        })
        expect(response.status).toBe(409)

        const db = createDb(env.OIDC_DB)
        const [row] = await db.select().from(user).where(eq(user.id, targetId)).limit(1)
        expect(row?.email).toBe('editable-email@example.com')
    })

    it('allows a PATCH that leaves email unchanged, even though it "conflicts" with the user\'s own row', async ({ expect }) => {
        const token = await adminToken('email-noop-admin@example.com')
        const targetId = await seedUser('unchanged-email@example.com', 'correct-horse-battery')

        const response = await call(`/api/admin/users/${targetId}`, token, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'Still Me', email: 'unchanged-email@example.com' })
        })
        expect(response.status).toBe(200)
    })

    it('closes the race — two concurrent creates with the same new email both resolve cleanly, only one user is created', async ({
        expect
    }) => {
        const token = await adminToken('race-admin@example.com')
        const createBody = JSON.stringify({ name: 'Racer', email: 'race-target@example.com' })

        const [first, second] = await Promise.all([
            call('/api/admin/users', token, { method: 'POST', headers: { 'content-type': 'application/json' }, body: createBody }),
            call('/api/admin/users', token, { method: 'POST', headers: { 'content-type': 'application/json' }, body: createBody })
        ])
        const statuses = [first.status, second.status].sort()
        expect(statuses).toEqual([200, 409])

        const db = createDb(env.OIDC_DB)
        const rows = await db.select().from(user).where(eq(user.email, 'race-target@example.com'))
        expect(rows).toHaveLength(1)
    })

    it('bans and unbans a user', async ({ expect }) => {
        const token = await adminToken('ban-admin@example.com')
        const targetId = await seedUser('bannable@example.com', 'correct-horse-battery')

        const banResponse = await call(`/api/admin/users/${targetId}/ban`, token, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ reason: 'testing' })
        })
        expect(banResponse.status).toBe(200)
        const db = createDb(env.OIDC_DB)
        const [banned] = await db.select().from(user).where(eq(user.id, targetId)).limit(1)
        expect(banned?.banned).toBe(true)
        expect(banned?.banReason).toBe('testing')

        const unbanResponse = await call(`/api/admin/users/${targetId}/unban`, token, { method: 'POST' })
        expect(unbanResponse.status).toBe(200)
        const [unbanned] = await db.select().from(user).where(eq(user.id, targetId)).limit(1)
        expect(unbanned?.banned).toBe(false)
        expect(unbanned?.banReason).toBeNull()
    })

    it('deletes a user, including cascading a pending invite', async ({ expect }) => {
        const token = await adminToken('deleter-admin@example.com')
        const createResponse = await call('/api/admin/users', token, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'Doomed', email: 'doomed@example.com' })
        })
        const { user: createdUser, inviteUrl } = await createResponse.json<{ user: { id: string }; inviteUrl: string }>()
        const inviteToken = new URL(inviteUrl).searchParams.get('token') ?? ''

        const deleteResponse = await call(`/api/admin/users/${createdUser.id}`, token, { method: 'DELETE' })
        expect(deleteResponse.status).toBe(200)

        const db = createDb(env.OIDC_DB)
        const [remainingUser] = await db.select().from(user).where(eq(user.id, createdUser.id)).limit(1)
        expect(remainingUser).toBeUndefined()
        const [remainingInvite] = await db.select().from(invite).where(eq(invite.token, inviteToken)).limit(1)
        expect(remainingInvite).toBeUndefined()
    })

    it('rejects an admin demoting, banning, or deleting themselves', async ({ expect }) => {
        await seedUser('self-lockout@example.com', 'correct-horse-battery', { role: 'admin' })
        const { id_token } = await signInForTokens('self-lockout@example.com', 'correct-horse-battery')
        const db = createDb(env.OIDC_DB)
        const [self] = await db.select().from(user).where(eq(user.email, 'self-lockout@example.com')).limit(1)
        if (!self) throw new Error('expected the seeded user to exist')

        const demote = await call(`/api/admin/users/${self.id}`, id_token, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ role: 'user' })
        })
        expect(demote.status).toBe(400)

        const ban = await call(`/api/admin/users/${self.id}/ban`, id_token, { method: 'POST' })
        expect(ban.status).toBe(400)

        const del = await call(`/api/admin/users/${self.id}`, id_token, { method: 'DELETE' })
        expect(del.status).toBe(400)
    })

    it('opens CORS on /api/admin/users', async ({ expect }) => {
        const response = await callAsApp(
            new Request('https://example.com/api/admin/users', { headers: { origin: 'https://admin.example.test' } })
        )
        expect(response.headers.get('access-control-allow-origin')).toBe('*')
    })
})
