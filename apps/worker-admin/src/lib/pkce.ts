function base64url(bytes: ArrayBuffer) {
    return btoa(String.fromCharCode(...new Uint8Array(bytes)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')
}

export async function createPkcePair() {
    const codeVerifier = base64url(crypto.getRandomValues(new Uint8Array(32)).buffer)
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier))
    const codeChallenge = base64url(digest)
    return { codeVerifier, codeChallenge }
}
