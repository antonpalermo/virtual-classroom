import { createFileRoute, redirect } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { authClient, getStoredToken } from '../lib/auth-client'

type ManagedUser = {
    id: string
    email: string
    role?: string | null
    banned?: boolean | null
}

const ROLE_OPTIONS = ['user', 'manager', 'admin'] as const

export const Route = createFileRoute('/')({
    beforeLoad: () => {
        if (!getStoredToken()) throw redirect({ to: '/login' })
    },
    component: DashboardRoute
})

function DashboardRoute() {
    const { data: session } = authClient.useSession()
    const [users, setUsers] = useState<ManagedUser[] | null>(null)
    const [loadError, setLoadError] = useState<string | null>(null)

    const viewerRole = session?.user.role ?? 'user'

    useEffect(() => {
        if (viewerRole === 'user') return
        authClient.admin.listUsers({ query: { limit: 100 } }).then(({ data, error }) => {
            if (error) {
                setLoadError(error.message ?? 'Failed to load users')
                return
            }
            setUsers((data?.users as ManagedUser[]) ?? [])
        })
    }, [viewerRole])

    if (viewerRole === 'user') {
        return (
            <div className="p-2">
                <h3>Access denied</h3>
                <p>Your account doesn't have admin or manager access.</p>
            </div>
        )
    }

    async function changeRole(userId: string, role: string) {
        const { error } = await authClient.admin.setRole({ userId, role })
        if (error) {
            setLoadError(error.message ?? 'Failed to change role')
            return
        }
        setUsers(current => current?.map(user => (user.id === userId ? { ...user, role } : user)) ?? null)
    }

    async function toggleBan(user: ManagedUser) {
        const action = user.banned ? authClient.admin.unbanUser : authClient.admin.banUser
        const { error } = await action({ userId: user.id })
        if (error) {
            setLoadError(error.message ?? 'Failed to update ban status')
            return
        }
        setUsers(current => current?.map(u => (u.id === user.id ? { ...u, banned: !u.banned } : u)) ?? null)
    }

    async function removeUser(userId: string) {
        const { error } = await authClient.admin.removeUser({ userId })
        if (error) {
            setLoadError(error.message ?? 'Failed to remove user')
            return
        }
        setUsers(current => current?.filter(u => u.id !== userId) ?? null)
    }

    const grantableRoles = viewerRole === 'admin' ? ROLE_OPTIONS : ROLE_OPTIONS.filter(role => role !== 'admin')

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
                        return (
                            <tr key={user.id}>
                                <td>{user.email}</td>
                                <td>
                                    <select
                                        value={user.role ?? 'user'}
                                        disabled={lockedForViewer}
                                        onChange={event => changeRole(user.id, event.target.value)}
                                    >
                                        {grantableRoles.map(role => (
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
