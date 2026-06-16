import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      // The web app manifest is hand-maintained in public/manifest.webmanifest
      // (linked from index.html alongside the apple-mobile-web-app meta tags).
      manifest: false,
      workbox: {
        // Precache the app shell + every lazy route chunk so tab switches are
        // instant after first load (no per-tab network fetch).
        globPatterns: ['**/*.{js,css,html,svg,webmanifest}'],
        cleanupOutdatedCaches: true,
        // SPA fallback, but never hijack the API — those stay network-only so
        // financial data is always fresh.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/],
      },
    }),
  ],
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
