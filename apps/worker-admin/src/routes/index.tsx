import { type AccessTokenClaims, verifyAccessToken } from '@capstone/auth-verify'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { authClient, clearStoredJwt, clearStoredSession, getStoredJwt } from '../lib/auth-client'

const JWKS_URL = 'http://localhost:8789/api/auth/jwks'

type ManagedUser = {
    id: string
    email: string
    role?: string | null
    banned?: boolean | null
}

const ROLE_OPTIONS = ['user', 'manager', 'admin'] as const
type RoleOption = (typeof ROLE_OPTIONS)[number]

export const Route = createFileRoute('/')({
    beforeLoad: () => {
        if (!getStoredJwt()) throw redirect({ to: '/login' })
    },
    component: DashboardRoute
})

function DashboardRoute() {
    // `beforeLoad` only proves a token *string* is in sessionStorage, not that it still verifies.
    // So three states have to stay distinct: still resolving, resolved-but-invalid (the stored
    // JWT is expired/malformed — drop it and go back to /login rather than stranding the user on
    // a permanent "Access denied"), and resolved with real claims.
    const [claims, setClaims] = useState<AccessTokenClaims | null | undefined>(undefined)
    const navigate = useNavigate()
    const [users, setUsers] = useState<ManagedUser[] | null>(null)
    const [loadError, setLoadError] = useState<string | null>(null)

    useEffect(() => {
        const jwt = getStoredJwt()
        if (!jwt) return
        verifyAccessToken(jwt, JWKS_URL).then(setClaims)
    }, [])

    const isPending = claims === undefined
    const tokenIsStale = !isPending && !claims
    const viewerRole = claims?.role ?? 'user'

    useEffect(() => {
        if (!tokenIsStale) return
        clearStoredJwt()
        clearStoredSession()
        navigate({ to: '/login' })
    }, [tokenIsStale, navigate])

    useEffect(() => {
        if (isPending || !claims || viewerRole === 'user') return
        authClient.admin.listUsers({ query: { limit: 100 } }).then(({ data, error }) => {
            if (error) {
                setLoadError(error.message ?? 'Failed to load users')
                return
            }
            setUsers((data?.users as ManagedUser[]) ?? [])
        })
    }, [isPending, claims, viewerRole])

    if (isPending) return <p className="p-2">Loading…</p>
    if (tokenIsStale) return <p className="p-2">Your session has expired. Redirecting to sign in…</p>

    if (viewerRole === 'user') {
        return (
            <div className="p-2">
                <h3>Access denied</h3>
                <p>Your account doesn't have admin or manager access.</p>
            </div>
        )
    }

    async function changeRole(userId: string, role: RoleOption) {
        const { error } = await authClient.admin.setRole({ userId, role })
        if (error) {
            setLoadError(error.message ?? 'Failed to change role')
            return
        }
        setLoadError(null)
        setUsers(current => current?.map(user => (user.id === userId ? { ...user, role } : user)) ?? null)
    }

    async function toggleBan(user: ManagedUser) {
        const action = user.banned ? authClient.admin.unbanUser : authClient.admin.banUser
        const { error } = await action({ userId: user.id })
        if (error) {
            setLoadError(error.message ?? 'Failed to update ban status')
            return
        }
        setLoadError(null)
        setUsers(current => current?.map(u => (u.id === user.id ? { ...u, banned: !u.banned } : u)) ?? null)
    }

    async function removeUser(userId: string) {
        const { error } = await authClient.admin.removeUser({ userId })
        if (error) {
            setLoadError(error.message ?? 'Failed to remove user')
            return
        }
        setLoadError(null)
        setUsers(current => current?.filter(u => u.id !== userId) ?? null)
    }

    const grantableRoles: readonly RoleOption[] = viewerRole === 'admin' ? ROLE_OPTIONS : ROLE_OPTIONS.filter(role => role !== 'admin')

    return (
        <div className="p-2">
            <h3>Users</h3>
            {loadError && <p>{loadError}</p>}
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
                    {users?.map(user => {
                        const lockedForViewer = viewerRole === 'manager' && user.role === 'admin'
                        const currentRole = (user.role ?? 'user') as RoleOption
                        const displayedRoles = grantableRoles.includes(currentRole) ? grantableRoles : [...grantableRoles, currentRole]
                        return (
                            <tr key={user.id}>
                                <td>{user.email}</td>
                                <td>
                                    <select
                                        value={currentRole}
                                        disabled={lockedForViewer}
                                        onChange={event => changeRole(user.id, event.target.value as RoleOption)}
                                    >
                                        {displayedRoles.map(role => (
                                            <option key={role} value={role}>
                                                {role}
                                            </option>
                                        ))}
                                    </select>
                                </td>
                                <td>{user.banned ? 'Banned' : 'Active'}</td>
                                <td>
                                    <button type="button" disabled={lockedForViewer} onClick={() => toggleBan(user)}>
                                        {user.banned ? 'Unban' : 'Ban'}
                                    </button>
                                    <button type="button" disabled={lockedForViewer} onClick={() => removeUser(user.id)}>
                                        Remove
                                    </button>
                                </td>
                            </tr>
                        )
                    })}
                </tbody>
            </table>
        </div>
    )
}
