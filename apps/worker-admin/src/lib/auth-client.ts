import { adminClient } from 'better-auth/client/plugins'
import { createAccessControl } from 'better-auth/plugins/access'
import { createAuthClient } from 'better-auth/react'

// Type-only stand-in for `apps/worker-auth`'s real access-control roles (admin/manager/user).
// The actual authorization decision always happens server-side in worker-auth — this exists
// purely so `authClient.admin.setRole`'s `role` param is typed as including "manager", without
// worker-admin depending on worker-auth's source.
const clientAc = createAccessControl({})
const clientRole = clientAc.newRole({})

const TOKEN_STORAGE_KEY = 'admin_token'

export function getStoredToken() {
    try {
        return sessionStorage.getItem(TOKEN_STORAGE_KEY) ?? undefined
    } catch {
        return undefined
    }
}

export function storeToken(token: string) {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, token)
}

export function clearStoredToken() {
    try {
        sessionStorage.removeItem(TOKEN_STORAGE_KEY)
    } catch {
        // sessionStorage can throw in a locked-down browser; nothing to recover here.
    }
}

export const authClient = createAuthClient({
    plugins: [adminClient({ roles: { admin: clientRole, manager: clientRole, user: clientRole } })],
    fetchOptions: {
        auth: {
            type: 'Bearer',
            token: getStoredToken
        }
    }
})
