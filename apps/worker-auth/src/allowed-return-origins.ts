export function parseAllowedReturnOrigins(env: Env): string[] {
    return (
        env.ALLOWED_RETURN_ORIGINS?.split(',')
            .map(origin => origin.trim())
            .filter(Boolean) ?? []
    )
}

export function isAllowedReturnTo(returnTo: string, allowedOrigins: string[]): boolean {
    return allowedOrigins.some(origin => returnTo === origin || returnTo.startsWith(`${origin}/`))
}
