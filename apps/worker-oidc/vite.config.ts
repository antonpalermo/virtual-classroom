import { cloudflare } from '@cloudflare/vite-plugin'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
    // Same port/inspector-port worker-oidc already used with `wrangler dev` directly — only the
    // mechanism serving them changed. worker-client, worker-realtime, worker-auth, and
    // worker-admin use 5173/9229, 8788/9231, 8789/9230, and 8790/9232 respectively.
    server: { port: 8791 },
    plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), cloudflare({ inspectorPort: 9233 })]
})
