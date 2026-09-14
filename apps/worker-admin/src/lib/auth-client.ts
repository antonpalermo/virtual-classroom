import { adminClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

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

export const authClient = createAuthClient({
    plugins: [adminClient()],
    fetchOptions: {
        auth: {
            type: 'Bearer',
            token: getStoredToken
        }
    }
})
