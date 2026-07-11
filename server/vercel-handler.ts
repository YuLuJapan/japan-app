// Source entry for the Vercel serverless function. This is bundled by
// `npm run build:api` (esbuild) into `api/[...path].js` as a single self-
// contained file so Vercel doesn't have to resolve cross-file ESM imports at
// runtime (which was failing with ERR_MODULE_NOT_FOUND on extensionless paths).
// External npm packages (express, @supabase/supabase-js) stay as normal imports
// that Vercel includes via dependency tracing.
import { createApp } from './src/app'

export default createApp()
