import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { storeSession } from '../lib/session'

export const Route = createFileRoute('/auth-callback')({
    component: AuthCallbackRoute
})

function AuthCallbackRoute() {
    const navigate = useNavigate()

    useEffect(() => {
        const params = new URLSearchParams(window.location.hash.slice(1))
        const token = params.get('token')
        const session = params.get('session')
        if (!token || !session) {
            navigate({ to: '/login' })
            return
        }
        storeSession({ token, session })
        navigate({ to: '/' })
    }, [navigate])

    return <p className="p-2">Signing in…</p>
}
