import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Listen on all interfaces so the site is reachable from other devices
  // on the local network.
  // 192.168.x.x is not routable from the internet, so this stays LAN-only
  // as long as the router does not port-forward to this machine.
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true,
  },
})
