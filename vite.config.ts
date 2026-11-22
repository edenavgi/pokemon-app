import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { configDefaults, defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  base: './', // needed for monday code hosting
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  server: {
    port: 5173,
    allowedHosts: true, // needed for the mapps tunnel
    // One tunnel serves the app AND the local server (server/, port 8080):
    // these paths go to the server, everything else to Vite.
    proxy: {
      '/api': 'http://localhost:8080',
      '/oauth': 'http://localhost:8080',
      '/telegram': 'http://localhost:8080',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: false,
    exclude: [...configDefaults.exclude, '.superpowers/**', 'server/**'], // server/ has its own Vitest config
  },
})
