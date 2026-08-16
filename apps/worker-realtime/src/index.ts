import { DurableObject } from 'cloudflare:workers'

export class Messenger extends DurableObject<CloudflareBindings> {
    constructor(ctx: DurableObjectState, env: CloudflareBindings) {
        super(ctx, env)
    }
}

export default {
    async fetch(_request, _env, _ctx): Promise<Response> {
        return new Response(JSON.stringify({ sample: 'sample' }))
    }
} satisfies ExportedHandler<CloudflareBindings>
