const TOKEN_KEY = 'client_token'
const SESSION_KEY = 'client_session'

export function storeSession({ token, session }: { token: string; session: string }) {
    sessionStorage.setItem(TOKEN_KEY, token)
    sessionStorage.setItem(SESSION_KEY, session)
}

export function clearStoredSession() {
    try {
        sessionStorage.removeItem(TOKEN_KEY)
        sessionStorage.removeItem(SESSION_KEY)
    } catch {
        // sessionStorage can throw in a locked-down browser; nothing to recover here.
    }
}

export function getStoredToken() {
    try {
        return sessionStorage.getItem(TOKEN_KEY) ?? undefined
    } catch {
        return undefined
    }
}
