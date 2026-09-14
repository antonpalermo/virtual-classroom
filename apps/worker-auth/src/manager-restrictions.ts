import type { BetterAuthPlugin } from 'better-auth'
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'
import { bearer } from 'better-auth/plugins'

// Every endpoint a `manager` can reach that either writes a role or acts on an existing account.
// `/admin/create-user` and `/admin/update-user` are here because `managerRole` (access-control.ts)
// carries `user: ['create', 'update']`, and both of those routes write the `role` column
// (node_modules/better-auth/dist/plugins/admin/routes.mjs: `createUser` reads `body.role`,
// `adminUpdateUser` reads `body.data.role`).
const RESTRICTED_PATHS = new Set([
    '/admin/set-role',
    '/admin/create-user',
    '/admin/update-user',
    '/admin/ban-user',
    '/admin/unban-user',
    '/admin/remove-user'
])

// `/admin/create-user` writes a brand-new row, so there is no existing target to inspect —
// only the "is this granting admin" half of the check applies to it.
const NO_TARGET_PATHS = new Set(['/admin/create-user'])

// Roles are never reliably a single string: `set-role`/`create-user` accept `string | string[]`
// (their zod schemas in node_modules/better-auth/dist/plugins/admin/routes.mjs), the column
// stores multiples comma-joined via that file's `parseRoles`, and `hasPermission`
// (node_modules/better-auth/dist/plugins/admin/has-permission.mjs) authorizes on
// `role.split(',')`. So `role === 'admin'` is trivially bypassed by `['admin']`, and a manager
// who parks `'manager,user'` on their own row keeps full manager rights while no longer matching
// a `=== 'manager'` actor check. Every comparison below is membership in this normalized list.
function roleList(value: unknown): string[] {
    if (value === undefined || value === null) return []
    const parts = Array.isArray(value) ? value : String(value).split(',')
    return parts.map(role => String(role).trim())
}

// `runBeforeHooks` (node_modules/better-auth/dist/api/dispatch.mjs) calls every registered
// `hooks.before` handler with the SAME original context and only merges the headers a hook
// returns into `modifiedContext` *after* the whole loop. So `bearer()`'s conversion of
// `Authorization: Bearer <token>` into the session cookie is invisible to this hook no matter
// where `bearer()` sits in `auth.ts`'s `plugins` array — `getSessionFromCtx` would see no
// cookie, find no session, and this hook would wave every bearer-authenticated request through.
// worker-admin authenticates *exclusively* by bearer token, so that was every real request.
// Reusing bearer's own handler (rather than re-implementing it) keeps the token handling —
// signed vs. raw token, HMAC verification — byte-identical to what the endpoint itself will see.
const bearerBeforeHook = bearer().hooks.before[0]

// biome-ignore lint/suspicious/noExplicitAny: better-auth's hook context type isn't exported
type HookCtx = any

async function sessionFor(ctx: HookCtx) {
    if (!bearerBeforeHook.matcher(ctx)) return getSessionFromCtx(ctx)
    const converted = await (bearerBeforeHook.handler as (c: HookCtx) => Promise<HookCtx>)({ ...ctx, returnHeaders: false })
    const headers = converted?.context?.headers
    return getSessionFromCtx(headers ? { ...ctx, headers } : ctx)
}

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
                    const session = await sessionFor(ctx)
                    if (!roleList(session?.user.role).includes('manager')) return

                    // `createUser` (node_modules/better-auth/dist/plugins/admin/routes.mjs) accepts
                    // the new user's role via EITHER field and does `ctx.body.role ?? dataRole` —
                    // so create-user has to check both, not just the top-level one.
                    const requestedRole =
                        ctx.path === '/admin/update-user' ? ctx.body?.data?.role : (ctx.body?.role ?? ctx.body?.data?.role)
                    if (roleList(requestedRole).includes('admin')) {
                        throw new APIError('FORBIDDEN', { message: 'Managers cannot grant the admin role.' })
                    }

                    if (NO_TARGET_PATHS.has(ctx.path)) return
                    const targetUserId = ctx.body?.userId as string | undefined
                    if (!targetUserId) return
                    const targetUser = await ctx.context.internalAdapter.findUserById(targetUserId)
                    if (roleList((targetUser as { role?: string } | null)?.role).includes('admin')) {
                        throw new APIError('FORBIDDEN', { message: 'Managers cannot act on admin accounts.' })
                    }
                })
            }
        ]
    }
} satisfies BetterAuthPlugin
