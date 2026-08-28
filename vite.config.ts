import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png', 'favicon-32.png'],
      manifest: {
        name: 'Onward',
        short_name: 'Onward',
        description: 'Your trip companion',
        theme_color: '#F1543F',
        background_color: '#FAF8F5',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // push + notificationclick handlers (public/push-sw.js), folded into
        // the generated service worker
        importScripts: ['/push-sw.js'],
        // jsPDF dynamically imports html2canvas, canvg and dompurify for its
        // `doc.html()` and SVG paths. The export writer uses neither — it
        // draws text and tables — so those three chunks are ~380 KB of install
        // weight for code that can never run here. Precaching is what makes an
        // offline export possible (research R2), and it is also what makes
        // every byte in the manifest a byte every phone downloads on install,
        // so the unreachable ones are left out of it. They are still built and
        // still served, so a future code path that does reach them works — it
        // just fetches them.
        globIgnores: [
          'assets/html2canvas*.js',
          'assets/canvg*.js',
          'assets/index.es*.js',
          'assets/purify.es*.js',
        ],
        navigateFallback: '/index.html',
        // never serve the SPA shell for API calls
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // trip data: fresh when online, last-known when offline
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 128, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Homepage sushi frames: cache once rather than re-fetching several
            // MB every time the app is opened. (Not precached: Workbox's glob
            // doesn't include .webp, so the install stays small and these fill
            // in on first visit.)
            //
            // Safe under CacheFirst only because each URL carries the asset
            // build's content hash (src/generated/sushi-frames.ts). With plain
            // filenames this rule silently mixed a stale generation with a
            // fresh one and the animation jumped mid-scroll.
            //
            // maxEntries must stay comfortably above the frame count, or the
            // LRU evicts frames that are still part of the current sequence and
            // they get re-fetched on every scroll. The headroom is what lets
            // the previous generation age out.
            urlPattern: ({ url }) => url.pathname.startsWith('/sushi/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'sushi-frames',
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }) => url.hostname === 'upload.wikimedia.org',
            handler: 'CacheFirst',
            options: {
              cacheName: 'photos',
              expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }) =>
              url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'fonts' },
          },
        ],
      },
    }),
  ],
  server: {
    port: 3000,
    proxy: {
      // 127.0.0.1, not localhost: Node resolves "localhost" to ::1 first, so
      // anything else already holding [::1]:3001 silently swallows every /api
      // call even though our server is up on 0.0.0.0:3001.
      '/api': 'http://127.0.0.1:3001',
    },
  },
})
