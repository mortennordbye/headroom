import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 'prompt' (not 'autoUpdate'): a new service worker WAITS instead of
      // activating mid-session. autoUpdate activates immediately and its
      // precache cleanup deletes the chunks the still-open tab is using, so a
      // lazy import 404s → blank screen. With 'prompt' the running tab keeps
      // its precache intact and the update applies on a clean, user-triggered
      // full reload (see UpdatePrompt) — eliminating the stale-chunk race.
      registerType: 'prompt',
      injectRegister: 'auto',
      // The web app manifest is hand-maintained in public/manifest.webmanifest
      // (linked from index.html alongside the apple-mobile-web-app meta tags).
      manifest: false,
      workbox: {
        // Precache the app shell + every lazy route chunk so tab switches are
        // instant after first load (no per-tab network fetch).
        globPatterns: ['**/*.{js,css,html,svg,woff2,webmanifest}'],
        cleanupOutdatedCaches: true,
        // Claim the open tab once the new worker activates. In 'prompt' mode
        // activation only happens after the user clicks Update (which posts
        // SKIP_WAITING), so this is safe — and it's REQUIRED: without it the new
        // worker never controls the already-open page, so the `controllerchange`
        // event that vite-plugin-pwa reloads on never fires and the Update button
        // silently does nothing. skipWaiting stays off (prompt semantics).
        clientsClaim: true,
        // SPA fallback, but never hijack the API — those stay network-only so
        // financial data is always fresh.
        navigateFallback: '/index.html',
        // Never serve index.html for API or hashed-asset requests — a missing
        // chunk must surface as a load error, not as HTML masquerading as JS.
        // Build output lives under /static (see build.assetsDir) so this can't
        // collide with the /assets client route (the Formue page).
        navigateFallbackDenylist: [/^\/api/, /^\/static\//],
      },
    }),
  ],
  build: {
    // Emit hashed chunks under /static instead of Vite's default /assets, which
    // collides with the app's `/assets` client route (the Formue page). With the
    // collision gone, a hard reload of /assets serves the SPA cleanly — no
    // serve-static directory redirect and no over-broad 404 guard needed.
    assetsDir: 'static',
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
