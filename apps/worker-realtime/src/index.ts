import { DurableObject } from 'cloudflare:workers'

export class Messenger extends DurableObject<Env> {
    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env)

        this.ctx.getWebSockets().forEach(ws => {
            const attachment = ws.deserializeAttachment()

            if (attachment) {
                console.log('attachment: ', attachment)
            }
        })

        this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
    }

    async fetch(_request: Request): Promise<Response> {
        const wsPair = new WebSocketPair()
        const [client, server] = Object.values(wsPair)

        this.ctx.acceptWebSocket(server)

        this.ctx.getWebSockets().forEach(ws => {
            ws.send('new peers has join')
        })

        return new Response(null, { status: 101, webSocket: client })
    }

    async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
        console.log(ws, message)
    }

    async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
        const message = error instanceof Error ? error.message : String(error)
        console.log('ws: ', ws, 'encountered ', message, 'error')
    }

    async webSocketClose(ws: WebSocket, code: number, reason: string, _wasClean: boolean): Promise<void> {
        ws.close(code, reason)
    }
}

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url)
        const room = url.searchParams.get('room')
        const upgradeHeader = request.headers.get('Upgrade')

        if (url.pathname === '/messenger') {
            if (!upgradeHeader || upgradeHeader !== 'websocket') {
                return new Response('worker expected upgrade header to contain websocket', { status: 426 })
            }

            if (request.method !== 'GET' || !room) {
                return new Response('worker failed to process your request', { status: 400 })
            }

            const id = env.MESSENGER.idFromName(room)
            const stub = env.MESSENGER.get(id)

            return stub.fetch(request)
        }

        return new Response('invalid request please try again later', { status: 200, headers: { 'Content-Type': 'text/plain' } })
    }
} satisfies ExportedHandler<Env>
