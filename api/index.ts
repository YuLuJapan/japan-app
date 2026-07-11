// Vercel serverless entry — the whole Node/Express backend as one function.
// Plain ESM re-export; relative imports carry explicit `.js` extensions so
// Node's ESM loader (and Vercel's per-file transpile) resolve them at runtime.
// A rewrite in vercel.json funnels every /api/* path to this function.
import { createApp } from '../server/src/app.js'

export default createApp()
