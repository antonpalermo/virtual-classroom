export async function sendPasswordResetEmail(env: Env, to: string, url: string) {
    const emailContent = {
        to,
        from: { name: 'klassroom', email: env.RESET_EMAIL_FROM },
        subject: 'Reset your klassroom password',
        body: `<p>We received a request to reset your password.</p><p><a href="${url}">Reset your password</a></p><p>This link is single-use and will expire automatically. If you didn't request this, you can safely ignore this email — your password won't be changed.</p>`
    }

    const response = await fetch(`${env.EMAIL_PROVIDER_ENDPOINT}/v1/send`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${env.EMAIL_PROVIDER_SECRET_KEY}`
        },
        body: JSON.stringify(emailContent)
    })

    // Better Auth catches and logs this, so the caller still gets its generic response.
    if (!response.ok) throw new Error(`Email send failed: ${response.status} ${await response.text()}`)
}
