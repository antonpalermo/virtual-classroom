import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle
} from '@capstone/ui/components/alert-dialog'
import { Button } from '@capstone/ui/components/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@capstone/ui/components/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@capstone/ui/components/select'
import { createFileRoute } from '@tanstack/react-router'
import { MoreHorizontal } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { CreateUserDialog, type NewUser } from '../components/create-user-dialog'
import { DataTable, type DataTableColumn } from '../components/data-table'
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
    const [pendingDelete, setPendingDelete] = useState<AdminUser | null>(null)

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

    async function handleDelete(user: AdminUser) {
        setPendingDelete(null)
        setLoadError(null)
        // A network failure throws instead of returning a response; toast it like any other failure.
        const response = await apiFetch(`/api/admin/users/${user.id}`, { method: 'DELETE' }).catch(() => null)
        if (!response?.ok) {
            toast.error((await response?.text().catch(() => '')) || 'Could not delete user.')
            return
        }
        toast.success(`Deleted ${user.email}.`)
        loadUsers()
    }

    const columns: DataTableColumn<AdminUser>[] = [
        { accessorKey: 'email', header: 'Email' },
        {
            accessorKey: 'role',
            header: 'Role',
            cell: ({ row: { original: row } }) => (
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
            )
        },
        {
            id: 'status',
            header: 'Status',
            cell: ({ row: { original: row } }) =>
                row.banned ? `Banned${row.banReason ? ` (${row.banReason})` : ''}` : row.pending ? 'Invited' : 'Active'
        },
        {
            id: 'actions',
            cell: ({ row: { original: row } }) => (
                <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${row.email}`} />}>
                        <MoreHorizontal />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-auto">
                        {row.pending && (
                            <DropdownMenuItem onClick={() => handleResendInvite(row.id, row.email)}>Resend invite</DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => handleBanToggle(row.id, row.banned)}>
                            {row.banned ? 'Unban' : 'Ban'}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onClick={() => setPendingDelete(row)}>
                            Delete
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            )
        }
    ]

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
            {users !== null && users.length > 0 && <DataTable columns={columns} data={users} getRowId={row => row.id} />}

            <AlertDialog open={pendingDelete !== null} onOpenChange={open => !open && setPendingDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete this user?</AlertDialogTitle>
                        <AlertDialogDescription>
                            {pendingDelete?.email} will be permanently deleted. This cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction variant="destructive" onClick={() => pendingDelete && handleDelete(pendingDelete)}>
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
