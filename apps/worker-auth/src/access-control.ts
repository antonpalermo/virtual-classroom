import { createAccessControl } from 'better-auth/plugins/access'

// Matches Better Auth's own built-in `adminAc` statement set
// (node_modules/better-auth/dist/plugins/admin/access/statement.mjs) — admin keeps every
// capability it already had before this module existed, nothing is silently dropped.
const statement = {
    user: [
        'create',
        'list',
        'set-role',
        'ban',
        'impersonate',
        'impersonate-admins',
        'delete',
        'set-password',
        'set-email',
        'get',
        'update'
    ],
    session: ['list', 'revoke', 'delete']
} as const

export const ac = createAccessControl(statement)

export const adminRole = ac.newRole({
    user: ['create', 'list', 'set-role', 'ban', 'impersonate', 'delete', 'set-password', 'set-email', 'get', 'update'],
    session: ['list', 'revoke', 'delete']
})

// Same action set as admin at the ac layer — the "manager can't touch admin accounts or grant
// the admin role" restriction is target-state-aware and can't be expressed here. See
// manager-restrictions.ts.
export const managerRole = ac.newRole({
    user: ['list', 'set-role', 'ban', 'delete']
})

export const userRole = ac.newRole({
    user: [],
    session: []
})
