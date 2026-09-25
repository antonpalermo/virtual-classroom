import { type AccessTokenClaims, verifyAccessToken } from '@capstone/auth-verify'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { clearStoredJwt, getStoredJwt } from '../lib/auth-client'

const OIDC_ORIGIN = import.meta.env.VITE_OIDC_ORIGIN ?? 'http://localhost:8791'
const JWKS_URL = `${OIDC_ORIGIN}/api/auth/jwks`
const ROLES = ['user', 'admin'] as const

interface AdminUser {
    id: string
    name: string
    email: string
    role: string
    banned: boolean
    banReason: string | null
    banExpires: string | null
    createdAt: string
}

export const Route = createFileRoute('/users')({
    beforeLoad: () => {
        if (!getStoredJwt()) throw redirect({ to: '/login' })
    },
    component: UsersRoute
})

function UsersRoute() {
    // Same three-state split as index.tsx: still-resolving, resolved-but-invalid, and
    // resolved-with-claims stay distinct so a stale token doesn't flash the table first.
    const [claims, setClaims] = useState<AccessTokenClaims | null | undefined>(undefined)

    useEffect(() => {
        const jwt = getStoredJwt()
        if (!jwt) return
        verifyAccessToken(jwt, JWKS_URL).then(setClaims)
    }, [])

    const isPending = claims === undefined
    const tokenIsStale = !isPending && !claims

    useEffect(() => {
        if (!tokenIsStale) return
        clearStoredJwt()
        window.location.href = '/login'
    }, [tokenIsStale])

    if (isPending) return <p className="p-2">Loading…</p>
    if (tokenIsStale) return <p className="p-2">Your session has expired. Redirecting to sign in…</p>
    // claims is narrowed to non-null past this point, but claims.role is only ever meaningful
    // for UI gating here — the API re-checks it fresh against D1 on every call, so a forged or
    // stale role claim in this token can't grant anything the server wouldn't already allow.
    if (claims?.role !== 'admin') return <p className="p-2">You're not authorized to manage users.</p>

    return <UserManagement jwt={getStoredJwt() ?? ''} />
}

function UserManagement({ jwt }: { jwt: string }) {
    const [users, setUsers] = useState<AdminUser[] | null>(null)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [inviteUrl, setInviteUrl] = useState<string | null>(null)

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

    async function handleCreate(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        setLoadError(null)
        const form = new FormData(event.currentTarget)
        const response = await apiFetch('/api/admin/users', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: form.get('name'), email: form.get('email') })
        })
        if (!response.ok) {
            setLoadError(await response.text().then(text => text || 'Could not create user.'))
            return
        }
        const { inviteUrl: url } = (await response.json()) as { inviteUrl: string }
        setInviteUrl(url)
        event.currentTarget.reset()
        loadUsers()
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
        <div className="p-2">
            <h3>Users</h3>
            {loadError && <p style={{ color: 'red' }}>{loadError}</p>}

            <form onSubmit={handleCreate}>
                <label>
                    Name <input type="text" name="name" required />
                </label>
                <label>
                    Email <input type="email" name="email" required />
                </label>
                <button type="submit">Create user</button>
            </form>
            {inviteUrl && (
                <p>
                    Invite link (copy and send to the new user): <input type="text" readOnly value={inviteUrl} size={60} />
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
                                    <select value={row.role} onChange={event => handleRoleChange(row.id, event.target.value)}>
                                        {ROLES.map(role => (
                                            <option key={role} value={role}>
                                                {role}
                                            </option>
                                        ))}
                                    </select>
                                </td>
                                <td>{row.banned ? `Banned${row.banReason ? ` (${row.banReason})` : ''}` : 'Active'}</td>
                                <td>
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
