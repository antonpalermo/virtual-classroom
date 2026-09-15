import { adminClient } from 'better-auth/client/plugins'
import { createAccessControl } from 'better-auth/plugins/access'
import { createAuthClient } from 'better-auth/react'

// Type-only stand-in for `apps/worker-auth`'s real access-control roles (admin/manager/user).
// The actual authorization decision always happens server-side in worker-auth — this exists
// purely so `authClient.admin.setRole`'s `role` param is typed as including "manager", without
// worker-admin depending on worker-auth's source.
const clientAc = createAccessControl({})
const clientRole = clientAc.newRole({})

// Better Auth's own opaque session token — used only to call /api/auth/admin/* (setRole/ban/etc).
const SESSION_STORAGE_KEY = 'admin_session'
// The signed access token from worker-auth's hosted login — used only for local role/identity checks.
const JWT_STORAGE_KEY = 'admin_jwt'

export function getStoredSession() {
    try {
        return sessionStorage.getItem(SESSION_STORAGE_KEY) ?? undefined
    } catch {
        return undefined
    }
}

export function storeSession(session: string) {
    sessionStorage.setItem(SESSION_STORAGE_KEY, session)
}

export function clearStoredSession() {
    try {
        sessionStorage.removeItem(SESSION_STORAGE_KEY)
    } catch {
        // sessionStorage can throw in a locked-down browser; nothing to recover here.
    }
}

export function getStoredJwt() {
    try {
        return sessionStorage.getItem(JWT_STORAGE_KEY) ?? undefined
    } catch {
        return undefined
    }
}

export function storeJwt(jwt: string) {
    sessionStorage.setItem(JWT_STORAGE_KEY, jwt)
}

export function clearStoredJwt() {
    try {
        sessionStorage.removeItem(JWT_STORAGE_KEY)
    } catch {
        // sessionStorage can throw in a locked-down browser; nothing to recover here.
    }
}

export const authClient = createAuthClient({
    plugins: [adminClient({ roles: { admin: clientRole, manager: clientRole, user: clientRole } })],
    fetchOptions: {
        auth: {
            type: 'Bearer',
            token: getStoredSession
        }
    }
})
