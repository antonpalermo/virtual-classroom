export async function sendPasswordResetEmail(env: Env, to: string, url: string) {
    await env.EMAIL.send({
        to,
        from: { email: env.RESET_EMAIL_FROM, name: 'worker-oidc' },
        subject: 'Reset your password',
        text: `We received a request to reset your password.\n\nReset it here: ${url}\n\nThis link is single-use and will expire automatically. If you didn't request this, you can safely ignore this email — your password won't be changed.`,
        html: `<p>We received a request to reset your password.</p><p><a href="${url}">Reset your password</a></p><p>This link is single-use and will expire automatically. If you didn't request this, you can safely ignore this email — your password won't be changed.</p>`
    })
}
