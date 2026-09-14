import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { storeToken } from '../lib/auth-client'

export const Route = createFileRoute('/auth-callback')({
    component: AuthCallbackRoute
})

function AuthCallbackRoute() {
    const navigate = useNavigate()

    useEffect(() => {
        const match = window.location.hash.match(/^#token=(.+)$/)
        if (!match) {
            navigate({ to: '/login' })
            return
        }
        storeToken(decodeURIComponent(match[1]))
        navigate({ to: '/' })
    }, [navigate])

    return <p className="p-2">Signing in…</p>
}
