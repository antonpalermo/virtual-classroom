import { createFileRoute, useNavigate } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
    component: HomeRoute
})

function HomeRoute() {
    const navigate = useNavigate()

    function createRoom() {
        const id = crypto.randomUUID()
        navigate({ from: '/', to: '/room', search: { id } })
    }

    return (
        <div className="p-2">
            <h3>Welcome!</h3>
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
