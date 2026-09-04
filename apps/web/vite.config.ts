import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Locally the web app reaches the API through the proxy; in production via VITE_API_URL.
    proxy: {
      '/api': { target: 'http://localhost:8879', rewrite: (p) => p.replace(/^\/api/, '') },
    },
  },
})
