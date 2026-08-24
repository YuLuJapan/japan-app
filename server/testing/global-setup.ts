// Boots one Supabase stack for the whole test run, runs the API against it,
// and tells the workers where both are.
//
// Once per run, not per file: starting five containers is tens of seconds and
// the data is reset between tests anyway (see setup.ts), so a stack per file
// would buy isolation the truncate already provides at a cost nobody would pay.
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { TestProject } from 'vitest/node'
import { provisionAccounts } from './accounts.js'
import { startOutsideWorld } from './outside-world.js'
import { startSupabaseStack } from './stack.js'
import { DB, stackEnv } from './stack-config.js'

declare module 'vitest' {
  export interface ProvidedContext {
    supabaseUrl: string
    /**
     * Origin of the real API, for the tests that reach it over HTTP the way a
     * browser does — the web suite, which renders components against it
     * instead of against a stubbed client.
     */
    apiUrl: string
    /**
     * The local stand-in for the internet the API fetches from. Web tests
     * steer it over its control endpoint (see src/tests/outside.ts).
     */
    outsideWorldUrl: string
    /** email → a real, signed-in JWT. */
    authTokens: Record<string, string>
    /** Where workers reach Postgres directly, to reset between tests. */
    dbHost: string
    dbPort: number
  }
}

/**
 * The Express app on a port of its own.
 *
 * In this process rather than the workers': the web suite runs in jsdom, and
 * an app assembled there would be the app as a bundler sees it, not as Node
 * runs it. Over a socket it is the same server the browser talks to.
 */
async function startApi(
  supabaseUrl: string,
  outsideWorldEnv: Record<string, string>
): Promise<{ url: string; server: Server }> {
  Object.assign(process.env, stackEnv(supabaseUrl), outsideWorldEnv)
  // Imported after the env is set: lib/supabase.ts caches its client on first
  // use, and one built from a half-set environment stays wrong all run.
  const { createApp } = await import('../src/app.js')
  const server = createServer(createApp())
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}`, server }
}

export default async function setup(project: TestProject) {
  const stack = await startSupabaseStack()
  const tokens = await provisionAccounts(stack.url, stack.pool)
  // Exchange rates, photo search and translation, served locally — the API
  // would otherwise reach for the real internet mid-test.
  const outside = await startOutsideWorld()
  const api = await startApi(stack.url, outside.env)

  const { host, port } = stack.pool.options as { host: string; port: number }
  project.provide('supabaseUrl', stack.url)
  project.provide('apiUrl', api.url)
  project.provide('outsideWorldUrl', outside.url)
  project.provide('authTokens', tokens)
  project.provide('dbHost', host ?? '127.0.0.1')
  project.provide('dbPort', port ?? DB.port)

  return async () => {
    await new Promise<void>((resolve) => api.server.close(() => resolve()))
    await outside.close()
    await stack.stop()
  }
}
