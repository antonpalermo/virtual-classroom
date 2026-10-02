// Shared by every outbound email (password reset, invites). RESET_EMAIL_FROM is the one verified
// sender address on our custom email platform — reused for invites rather than adding a second.
async function sendEmail(env: Env, to: string, subject: string, body: string) {
    const response = await fetch(`${env.EMAIL_PROVIDER_ENDPOINT}/v1/send`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${env.EMAIL_PROVIDER_SECRET_KEY}`
        },
        body: JSON.stringify({ to, from: { name: 'klassroom', email: env.RESET_EMAIL_FROM }, subject, body })
    })

    if (!response.ok) throw new Error(`Email send failed: ${response.status} ${await response.text()}`)
}

// Better Auth catches and logs a throw from this, so the caller still gets its generic response.
export function sendPasswordResetEmail(env: Env, to: string, url: string) {
    return sendEmail(
        env,
        to,
        'Reset your klassroom password',
        `<p>We received a request to reset your password.</p><p><a href="${url}">Reset your password</a></p><p>This link is single-use and will expire automatically. If you didn't request this, you can safely ignore this email — your password won't be changed.</p>`
    )
}

export function sendInviteEmail(env: Env, to: string, url: string) {
    return sendEmail(
        env,
        to,
        "You've been invited to klassroom",
        `<p>An administrator created a klassroom account for you.</p><p><a href="${url}">Set your password</a></p><p>This link is single-use and expires in 7 days.</p>`
    )
}
