// Local dev API server — Vite (port 3000) proxies /api here (port 3001).
// Production uses api/index.ts on Vercel instead.
import { readFileSync } from 'node:fs'
import { createApp } from './src/app.js'

// tiny .env.local loader (no dotenv dep); real deployments use platform env vars
try {
  for (const line of readFileSync('.env.local', 'utf-8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
  }
} catch {
  // no .env.local — defaults apply (memory backend, dev access code)
}

const port = Number(process.env.API_PORT ?? 3001)
createApp().listen(port, () => {
  console.log(`[api] listening on http://localhost:${port} (DATA_BACKEND=${process.env.DATA_BACKEND ?? 'memory'})`)
})
