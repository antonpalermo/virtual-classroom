import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
    server: { port: 8790 },
    // worker-client, worker-realtime, and worker-oidc use 5173/9229, 8788/9231, and 8791/9233.
    plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss(), cloudflare({ inspectorPort: 9232 })]
})
