import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
    component: IndexRoute
})

function IndexRoute() {
    return <p className="p-2">worker-oidc — OpenID Connect provider.</p>
}
