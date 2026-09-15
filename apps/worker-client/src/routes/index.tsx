import { type AccessTokenClaims, verifyAccessToken } from '@capstone/auth-verify'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { clearStoredSession, getStoredToken } from '../lib/session'

const JWKS_URL = 'http://localhost:8789/api/auth/jwks'

export const Route = createFileRoute('/')({
    component: HomeRoute
})

function HomeRoute() {
    const navigate = useNavigate()
    const [claims, setClaims] = useState<AccessTokenClaims | null | undefined>(undefined)

    useEffect(() => {
        const token = getStoredToken()
        if (!token) {
            setClaims(null)
            return
        }
        verifyAccessToken(token, JWKS_URL).then(setClaims)
    }, [])

    const isPending = claims === undefined

    function createRoom() {
        const id = crypto.randomUUID()
        navigate({ from: '/', to: '/room', search: { id } })
    }

    function signOut() {
        clearStoredSession()
        setClaims(null)
    }

    return (
        <div className="p-2">
            <h3>Welcome!</h3>
            {!isPending &&
                (claims ? (
                    <p>
                        Signed in as {claims.email}{' '}
                        <button type="button" onClick={signOut}>
                            Sign out
                        </button>
                    </p>
                ) : (
                    <p>
                        <Link to="/login">Sign in</Link>
                    </p>
                ))}
            <form>
                <div>
                    <label htmlFor="room-id">Join</label>
                    <input type="text" name="room-id" id="room-id" />
                    <button type="submit">Join</button>
                </div>
            </form>
            <br />
            <span>Create a new instan meeting</span>
            <button type="button" onClick={createRoom}>
                Create
            </button>
        </div>
    )
}
