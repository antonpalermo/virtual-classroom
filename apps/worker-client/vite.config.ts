import { cloudflare } from '@cloudflare/vite-plugin'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
    server: { port: 5173 },
    // worker-realtime, worker-auth, worker-admin, and worker-oidc use inspector ports 9231/9230/9232/9233 to avoid colliding with this.
    plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), cloudflare({ inspectorPort: 9229 })]
})
