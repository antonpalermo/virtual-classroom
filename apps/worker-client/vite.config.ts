import { cloudflare } from '@cloudflare/vite-plugin'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
    server: { port: 5173 },
    // worker-realtime and worker-auth use inspector_port 9231/9230 to avoid colliding with this.
    plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), cloudflare({ inspectorPort: 9229 })]
})
