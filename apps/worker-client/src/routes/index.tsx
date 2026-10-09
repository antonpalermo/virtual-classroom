import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { clearStoredJwt, redirectToSignIn } from '../lib/auth-client'

export const Route = createFileRoute('/')({
    component: HomeRoute
})

function HomeRoute() {
    const navigate = useNavigate()
    const { claims } = Route.useRouteContext()

    function createRoom() {
        const id = crypto.randomUUID()
        navigate({ from: '/', to: '/room', search: { id } })
    }

    function signOut() {
        clearStoredJwt()
        redirectToSignIn()
    }

    return (
        <div className="p-2">
            <h3>Welcome!</h3>
            <p>
                Signed in as {claims?.email}{' '}
                <button type="button" onClick={signOut}>
                    Sign out
                </button>
            </p>
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
