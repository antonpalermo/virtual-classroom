import type { BetterAuthPlugin } from 'better-auth'
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'

const RESTRICTED_PATHS = new Set(['/admin/set-role', '/admin/ban-user', '/admin/unban-user', '/admin/remove-user'])

// The `admin` plugin's access-control model (access-control.ts) only checks what the *actor's*
// role can do, never the *target's* current role or the requested value — so "manager can't
// grant admin" and "manager can't touch an admin account" both have to be enforced here instead.
export const managerRestrictions = {
    id: 'manager-restrictions',
    hooks: {
        before: [
            {
                matcher: context => RESTRICTED_PATHS.has(context.path),
                handler: createAuthMiddleware(async ctx => {
                    const session = await getSessionFromCtx(ctx)
                    if (session?.user.role !== 'manager') return

                    if (ctx.path === '/admin/set-role' && ctx.body?.role === 'admin') {
                        throw new APIError('FORBIDDEN', { message: 'Managers cannot grant the admin role.' })
                    }

                    const targetUserId = ctx.body?.userId as string | undefined
                    if (!targetUserId) return
                    const targetUser = await ctx.context.internalAdapter.findUserById(targetUserId)
                    if (targetUser && (targetUser as { role?: string }).role === 'admin') {
                        throw new APIError('FORBIDDEN', { message: 'Managers cannot act on admin accounts.' })
                    }
                })
            }
        ]
    }
} satisfies BetterAuthPlugin
