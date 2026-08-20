import { createFileRoute } from '@tanstack/react-router'

type RoomSearch = {
    id: string
}

export const Route = createFileRoute('/room')({
    component: RoomRoute,
    validateSearch: (search: Record<string, unknown>): RoomSearch => {
        return { id: (search.id as string) || '' }
    }
})

function RoomRoute() {
    const { id } = Route.useSearch()

    return <div className="p-2">Room ID: {id}</div>
}
