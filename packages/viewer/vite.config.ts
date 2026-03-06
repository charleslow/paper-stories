import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: '/paper-stories/',  // Absolute paths for browser; Tailscale strips prefix before backend sees it
  server: {
    host: '127.0.0.1',
    allowedHosts: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 5174,
    allowedHosts: true,
  },
  plugins: [react()],
})
