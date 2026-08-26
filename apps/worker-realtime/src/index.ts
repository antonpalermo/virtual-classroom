import { DurableObject } from 'cloudflare:workers'
import * as HTTP_STATUS from '@capstone/standards/status-codes'
import * as HTTP_PHRASES from '@capstone/standards/status-phrases'

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

        return new Response(null, { status: HTTP_STATUS.SWITCHING_PROTOCOLS, webSocket: client })
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
    async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url)
        const room = url.searchParams.get('room')
        const upgradeHeader = request.headers.get('Upgrade')

        if (url.pathname === '/messenger') {
            if (!upgradeHeader || upgradeHeader !== 'websocket') {
                return new Response(HTTP_PHRASES.UPGRADE_REQUIRED, { status: HTTP_STATUS.UPGRADE_REQUIRED })
            }

            if (request.method !== 'GET' || !room) {
                return new Response(HTTP_PHRASES.BAD_REQUEST, { status: HTTP_STATUS.BAD_REQUEST })
            }

            const id = env.MESSENGER.idFromName(room)
            const stub = env.MESSENGER.get(id)

            return stub.fetch(request)
        }

        return new Response('invalid request please try again later', { status: HTTP_STATUS.OK, headers: { 'Content-Type': 'text/plain' } })
    }
} satisfies ExportedHandler<Env>
