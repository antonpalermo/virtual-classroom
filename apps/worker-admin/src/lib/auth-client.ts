const JWT_STORAGE_KEY = 'admin_jwt'

export function getStoredJwt() {
    try {
        return sessionStorage.getItem(JWT_STORAGE_KEY) ?? undefined
    } catch {
        return undefined
    }
}

export function storeJwt(jwt: string) {
    try {
        sessionStorage.setItem(JWT_STORAGE_KEY, jwt)
    } catch {
        // sessionStorage can throw in a locked-down browser; nothing to recover here.
    }
}

export function clearStoredJwt() {
    try {
        sessionStorage.removeItem(JWT_STORAGE_KEY)
    } catch {
        // sessionStorage can throw in a locked-down browser; nothing to recover here.
    }
}
