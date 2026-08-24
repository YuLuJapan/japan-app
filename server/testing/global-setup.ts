// Boots one Supabase stack for the whole test run and tells the workers where
// it is.
//
// Once per run, not per file: starting five containers is tens of seconds and
// the data is reset between tests anyway (see setup.ts), so a stack per file
// would buy isolation the truncate already provides at a cost nobody would pay.
import type { TestProject } from 'vitest/node'
import { provisionAccounts } from './accounts.js'
import { startSupabaseStack } from './stack.js'
import { DB } from './stack-config.js'

declare module 'vitest' {
  export interface ProvidedContext {
    supabaseUrl: string
    /** email → a real, signed-in JWT. */
    authTokens: Record<string, string>
    /** Where workers reach Postgres directly, to reset between tests. */
    dbHost: string
    dbPort: number
  }
}

export default async function setup(project: TestProject) {
  const stack = await startSupabaseStack()
  const tokens = await provisionAccounts(stack.url, stack.pool)

  const { host, port } = stack.pool.options as { host: string; port: number }
  project.provide('supabaseUrl', stack.url)
  project.provide('authTokens', tokens)
  project.provide('dbHost', host ?? '127.0.0.1')
  project.provide('dbPort', port ?? DB.port)

  return async () => {
    await stack.stop()
  }
}
