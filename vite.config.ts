import { createReadStream, cpSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { type Plugin, defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const pdfjsRoot = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))

/**
 * Serve pdf.js's on-demand resources at /pdfjs — the standard 14 fonts and the
 * predefined CJK cMaps (see src/pdf/engine.pdfjs.ts for why a document preview
 * needs them).
 *
 * Copied from the installed package rather than vendored into `public/`: they
 * are ~2.5 MB of binaries that belong to a version of pdfjs-dist, and a copy
 * in git would go stale against package.json silently. Dev serves them
 * straight out of node_modules and the build copies them into `dist`, so the
 * URL is the same in both and there is no branch in the app code.
 *
 * Nothing here is a bundle input, so none of it reaches a chunk or the
 * precache manifest; a file is fetched only when a document names it.
 */
function pdfjsResources(): Plugin {
  const dirs = ['standard_fonts', 'cmaps']
  const fileFor = (url: string) => {
    const rel = path.normalize(decodeURIComponent(url.split('?')[0])).replace(/^(\.\.[/\\])+/, '')
    const full = path.join(pdfjsRoot, rel)
    // Confine to the two directories: this middleware is dev-only, but a path
    // that escapes them would still be reading the developer's disk.
    return dirs.some((d) => full.startsWith(path.join(pdfjsRoot, d) + path.sep)) ? full : null
  }

  let outDir = 'dist'

  return {
    name: 'pdfjs-resources',
    configResolved(config) {
      outDir = config.build.outDir
    },
    configureServer(server) {
      server.middlewares.use('/pdfjs', (req, res, next) => {
        const file = req.url ? fileFor(req.url) : null
        if (!file || !existsSync(file)) return next()
        res.setHeader('Content-Type', 'application/octet-stream')
        createReadStream(file).pipe(res)
      })
    },
    closeBundle() {
      for (const dir of dirs) {
        cpSync(path.join(pdfjsRoot, dir), path.join(outDir, 'pdfjs', dir), { recursive: true })
      }
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    pdfjsResources(),
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
        //
        // Leaflet and its stylesheet are left out for a different reason, and
        // it is a requirement rather than an optimisation (FR-014, research
        // R4): the OSM tile policy forbids bulk pre-fetching, so map *imagery*
        // can never be precached — and precaching the engine that draws it
        // buys install weight on every phone and no offline capability at all.
        // The map screen's own chunk stays in the manifest deliberately: with
        // no connection it still has to open and list the places it would have
        // pinned (FR-026, SC-007), which is the whole offline story here.
        // pdf.js, which draws the document preview, is the third exclusion and
        // the closest call. Its engine chunk and worker are ~1.7 MB — more
        // than the entire precache without them — and precaching would make
        // every phone pay that on install for a screen most sessions never
        // open. It is left out and given a CacheFirst rule below instead, the
        // same trade the gate videos make: the first document opened needs a
        // connection, and every one after that does not. (The worker is
        // emitted as .mjs, which Workbox's glob does not match anyway; naming
        // it here keeps the decision in one place rather than resting on
        // that.)
        globIgnores: [
          'assets/html2canvas*.js',
          'assets/canvg*.js',
          'assets/index.es*.js',
          'assets/purify.es*.js',
          'assets/engine.leaflet*.js',
          'assets/engine.pdfjs*.js',
          'assets/pdf.worker*.mjs',
          'pdfjs/**',
          'assets/engine-*.css',
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
            // The sign-in screen's video backdrop (public/gate/): ~1.7 MB of
            // silent H.264 that must not be in the precache — mp4 is outside
            // Workbox's glob deliberately, so the install stays small and the
            // clips are fetched by the one screen that shows them. CacheFirst
            // is what keeps a second visit from paying for them again.
            //
            // Unlike the sushi frames these filenames carry no build hash, so
            // a replaced clip would be served stale for as long as the entry
            // lives; the expiry is short enough to make that a day rather than
            // a month, and re-cutting a clip should change its filename.
            urlPattern: ({ url }) => url.pathname.startsWith('/gate/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'gate-backdrop',
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 },
              // A video is fetched with a Range header, and Safari's partial
              // responses come back 206 — uncacheable without this plugin,
              // which asks for the whole file and caches that instead.
              cacheableResponse: { statuses: [0, 200] },
              rangeRequests: true,
            },
          },
          {
            // The pdf.js engine, its worker and the font/cMap resources it
            // fetches per document — all kept out of the precache above. The
            // aim is that a boarding pass opened once at home still opens at
            // the gate.
            //
            // The two chunks carry Vite's content hash, so CacheFirst is safe
            // for them in the way it is for the sushi frames. The /pdfjs/
            // files do not: like the gate clips they are plain filenames, so a
            // pdfjs-dist upgrade would be served stale until the entry ages
            // out — a month here, and the failure is a substituted glyph
            // rather than a broken screen.
            urlPattern: ({ url }) =>
              /\/assets\/(engine\.pdfjs|pdf\.worker)/.test(url.pathname) ||
              url.pathname.startsWith('/pdfjs/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'pdf-engine',
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 30 },
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
