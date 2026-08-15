import { DurableObject } from 'cloudflare:workers'
import * as HTTP_STATUS from '@capstone/web-standards/status-codes'

/**
 * Welcome to Cloudflare Workers! This is your first Durable Objects application.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your Durable Object in action
 * - Run `npm run deploy` to publish your application
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/durable-objects
 */

/** A Durable Object's behavior is defined in an exported Javascript class */
export class Messenger extends DurableObject<Env> {
    sessions: Map<WebSocket, { [key: string]: string }>

    /**
     * The constructor is invoked once upon creation of the Durable Object, i.e. the first call to
     * 	`DurableObjectStub::get` for a given identifier (no-op constructors can be omitted)
     *
     * @param ctx - The interface for interacting with Durable Object state
     * @param env - The interface to reference bindings declared in wrangler.jsonc
     */
    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env)
        this.sessions = new Map()

        this.ctx.getWebSockets().forEach(ws => {
            const attachments = ws.deserializeAttachment()

            if (attachments) {
                this.sessions.set(ws, { ...attachments })
            }
        })

        this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
    }

    async fetch(_: Request): Promise<Response> {
        const wsPair = new WebSocketPair()
        const [client, server] = Object.values(wsPair)

        this.ctx.acceptWebSocket(server)

        const id = crypto.randomUUID()

        server.serializeAttachment({ id })

        this.sessions.set(server, { id })

        return new Response(null, { status: HTTP_STATUS.SWITCHING_PROTOCOLS, webSocket: client })
    }

    async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
        const session = this.sessions.get(ws)

        if (!session) {
            return
        }

        ws.send(
            `[Durable Object] message: ${message}, from: ${session.id}, to: the initiating client. Total connections: ${this.sessions.size}`
        )

        this.sessions.forEach((_, connectedWs) => {
            connectedWs.send(
                `[Durable Object] message: ${message}, from: ${session.id}, to: all clients. Total connections: ${this.sessions.size}`
            )
        })

        this.sessions.forEach((_, connectedWs) => {
            if (connectedWs !== ws) {
                connectedWs.send(
                    `[Durable Object] message: ${message}, from: ${session.id}, to: all clients except the initiating client. Total connections: ${this.sessions.size}`
                )
            }
        })
    }

    async webSocketClose(ws: WebSocket, code: number, reason: string, _wasClean: boolean) {
        ws.close(code, reason)
        this.sessions.delete(ws)
    }
}

export default {
    /**
     * This is the standard fetch handler for a Cloudflare Worker
     *
     * @param request - The request submitted to the Worker from the client
     * @param env - The interface to reference bindings declared in wrangler.jsonc
     * @param ctx - The execution context of the Worker
     * @returns The response to be sent back to the client
     */
    async fetch(request, env, _ctx): Promise<Response> {
        if (request.url.endsWith('/websocket')) {
            const upgradeHeader = request.headers.get('Upgrade')
            if (!upgradeHeader || upgradeHeader !== 'websocket') {
                return new Response('Worker expected upgrade: websocket', { status: HTTP_STATUS.UPGRADE_REQUIRED })
            }

            if (request.method !== 'GET') {
                return new Response('Worker expected GET method', {
                    status: HTTP_STATUS.BAD_REQUEST
                })
            }

            const stub = env.MESSENGER.getByName('foo')

            return stub.fetch(request)
        }

        return new Response(`Supported endpoints: /websocket: Expects a WebSocket upgrade request`, {
            status: HTTP_STATUS.OK,
            headers: {
                'Content-Type': 'text/plain'
            }
        })
    }
} satisfies ExportedHandler<Env>
