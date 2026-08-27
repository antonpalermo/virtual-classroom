import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { authClient } from '../lib/auth-client'

export const Route = createFileRoute('/')({
    component: HomeRoute
})

function HomeRoute() {
    const navigate = useNavigate()
    const { data: session, isPending } = authClient.useSession()

    function createRoom() {
        const id = crypto.randomUUID()
        navigate({ from: '/', to: '/room', search: { id } })
    }

    return (
        <div className="p-2">
            <h3>Welcome!</h3>
            {!isPending &&
                (session ? (
                    <p>
                        Signed in as {session.user.email}{' '}
                        <button type="button" onClick={() => authClient.signOut()}>
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
