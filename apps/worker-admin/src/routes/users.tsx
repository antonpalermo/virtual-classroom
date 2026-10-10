import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@capstone/ui/components/select'
import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { CreateUserDialog, type NewUser } from '../components/create-user-dialog'
import { getStoredJwt } from '../lib/auth-client'
import { ROLES } from '../lib/validators'

const OIDC_ORIGIN = import.meta.env.VITE_OIDC_ORIGIN ?? 'http://localhost:8791'

interface AdminUser {
    id: string
    name: string
    email: string
    role: string
    banned: boolean
    banReason: string | null
    banExpires: string | null
    createdAt: string
    pending: boolean
}

interface InviteResult {
    email: string
    inviteUrl: string
    emailSent: boolean
}

export const Route = createFileRoute('/users')({
    component: UsersRoute
})

function UsersRoute() {
    const { claims } = Route.useRouteContext()

    // claims.role is only ever meaningful for UI gating here — the API re-checks it fresh against
    // D1 on every call, so a forged or stale role claim in this token can't grant anything the
    // server wouldn't already allow.
    if (claims?.role !== 'admin') return <p>You're not authorized to manage users.</p>

    return <UserManagement jwt={getStoredJwt() ?? ''} />
}

function UserManagement({ jwt }: { jwt: string }) {
    const [users, setUsers] = useState<AdminUser[] | null>(null)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [invite, setInvite] = useState<InviteResult | null>(null)

    const apiFetch = useCallback(
        (path: string, init: RequestInit = {}) => {
            return fetch(`${OIDC_ORIGIN}${path}`, {
                ...init,
                headers: { ...(init.headers ?? {}), authorization: `Bearer ${jwt}` }
            })
        },
        [jwt]
    )

    const loadUsers = useCallback(async () => {
        const response = await apiFetch('/api/admin/users')
        if (!response.ok) {
            setLoadError('Could not load users.')
            return
        }
        const { users: rows } = (await response.json()) as { users: AdminUser[] }
        setUsers(rows)
        setLoadError(null)
    }, [apiFetch])

    useEffect(() => {
        loadUsers()
    }, [loadUsers])

    // Returns the error to show in the dialog, or null on success.
    async function handleCreate(user: NewUser) {
        setLoadError(null)
        const response = await apiFetch('/api/admin/users', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: user.name, email: user.email, role: user.role })
        })
        if (!response.ok) return await response.text().then(text => text || 'Could not create user.')
        const { inviteUrl, emailSent } = (await response.json()) as Omit<InviteResult, 'email'>
        setInvite({ email: user.email, inviteUrl, emailSent })
        loadUsers()
        return null
    }

    async function handleResendInvite(id: string, email: string) {
        setLoadError(null)
        const response = await apiFetch(`/api/admin/users/${id}/invite`, { method: 'POST' })
        if (!response.ok) {
            setLoadError(await response.text().then(text => text || 'Could not resend invite.'))
            return
        }
        const { inviteUrl, emailSent } = (await response.json()) as Omit<InviteResult, 'email'>
        setInvite({ email, inviteUrl, emailSent })
    }

    async function handleRoleChange(id: string, role: string) {
        setLoadError(null)
        const response = await apiFetch(`/api/admin/users/${id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ role })
        })
        if (!response.ok) {
            setLoadError(await response.text().then(text => text || 'Could not change role.'))
            return
        }
        loadUsers()
    }

    async function handleBanToggle(id: string, banned: boolean) {
        setLoadError(null)
        const response = await apiFetch(`/api/admin/users/${id}/${banned ? 'unban' : 'ban'}`, { method: 'POST' })
        if (!response.ok) {
            setLoadError(await response.text().then(text => text || 'Could not update ban status.'))
            return
        }
        loadUsers()
    }

    async function handleDelete(id: string) {
        if (!window.confirm('Delete this user? This cannot be undone.')) return
        setLoadError(null)
        const response = await apiFetch(`/api/admin/users/${id}`, { method: 'DELETE' })
        if (!response.ok) {
            setLoadError(await response.text().then(text => text || 'Could not delete user.'))
            return
        }
        loadUsers()
    }

    return (
        <div>
            <h3>Users</h3>
            {loadError && <p style={{ color: 'red' }}>{loadError}</p>}

            <CreateUserDialog onCreate={handleCreate} />
            {invite?.emailSent && <p>Invite sent to {invite.email}.</p>}
            {invite && !invite.emailSent && (
                <p style={{ color: 'red' }}>
                    Couldn't email {invite.email}. Copy this invite link and send it yourself:{' '}
                    <input type="text" readOnly value={invite.inviteUrl} size={60} />
                </p>
            )}

            {users === null && <p>Loading users…</p>}
            {users !== null && users.length === 0 && <p>No users yet.</p>}
            {users !== null && users.length > 0 && (
                <table>
                    <thead>
                        <tr>
                            <th>Email</th>
                            <th>Role</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {users.map(row => (
                            <tr key={row.id}>
                                <td>{row.email}</td>
                                <td>
                                    <Select value={row.role} onValueChange={role => role && handleRoleChange(row.id, role)}>
                                        <SelectTrigger size="sm" aria-label={`Role for ${row.email}`}>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {ROLES.map(role => (
                                                <SelectItem key={role} value={role}>
                                                    {role}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </td>
                                <td>
                                    {row.banned
                                        ? `Banned${row.banReason ? ` (${row.banReason})` : ''}`
                                        : row.pending
                                          ? 'Invited'
                                          : 'Active'}
                                </td>
                                <td>
                                    {row.pending && (
                                        <button type="button" onClick={() => handleResendInvite(row.id, row.email)}>
                                            Resend invite
                                        </button>
                                    )}
                                    <button type="button" onClick={() => handleBanToggle(row.id, row.banned)}>
                                        {row.banned ? 'Unban' : 'Ban'}
                                    </button>
                                    <button type="button" onClick={() => handleDelete(row.id)}>
                                        Delete
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    )
}
