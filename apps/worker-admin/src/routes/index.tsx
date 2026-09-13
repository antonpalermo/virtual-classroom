import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
    component: HomeRoute
})

function HomeRoute() {
    return (
        <div className="p-2">
            <h3>Admin</h3>
        </div>
    )
}
