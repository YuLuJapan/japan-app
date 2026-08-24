// One definition of the local Supabase stack, shared by the two things that
// start one: `local/docker-compose.yml` (the dev environment) and
// `server/testing/stack.ts` (the containers tests run against).
//
// The values here are duplicated as literals in the compose file, because a
// compose file cannot import TypeScript. `stack-config.test.ts` reads the YAML
// back and asserts the two agree, so the duplication cannot rot silently.
//
// Everything in this file is a fixed local-only credential. It is checked in
// on purpose: a throwaway stack on a private docker network has nothing to
// protect, and generating secrets per run would mean the compose stack and the
// test stack could never share a definition. None of it reaches a real project.
import { createHmac } from 'node:crypto'

/** Image tags. Pinned — a stack that drifts under you is not a fixture. */
export const IMAGES = {
  db: 'supabase/postgres:15.8.1.060',
  rest: 'postgrest/postgrest:v12.2.3',
  auth: 'supabase/gotrue:v2.177.0',
  storage: 'supabase/storage-api:v1.11.13',
  gateway: 'nginx:1.27-alpine',
} as const

/** What every service signs and verifies with. */
export const JWT_SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long'

export const DB = {
  user: 'postgres',
  password: 'postgres',
  database: 'postgres',
  /** Port inside the container; the host port is allocated per stack. */
  port: 5432,
} as const

/** The port nginx listens on inside the container. */
export const GATEWAY_PORT = 8000

/** Fixed host ports for the compose stack, matching the Supabase CLI's. */
export const COMPOSE_PORTS = { gateway: 54321, db: 54322 } as const

/**
 * A Supabase API key is just a JWT carrying a Postgres role. Signing them here
 * rather than pasting opaque strings means the role each one grants is
 * readable, and `ANON_KEY`/`SERVICE_KEY` below are checked against these.
 *
 * `iat`/`exp` are fixed rather than relative so the output is a constant: the
 * compose file needs the same literal string, and a token that changed per
 * call could never be written down there.
 */
export function signApiKey(role: 'anon' | 'service_role', secret = JWT_SECRET): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const header = encode({ alg: 'HS256', typ: 'JWT' })
  // 2100-01-01 — past the point where an expiring fixture is anyone's problem.
  const body = encode({ iss: 'supabase-local', role, iat: 1700000000, exp: 4102444800 })
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${signature}`
}

/** The browser-side key: the app's `SUPABASE_PUBLISHABLE_KEY`. */
export const ANON_KEY = signApiKey('anon')

/** The server-side key that bypasses RLS: the app's `SUPABASE_SECRET_KEY`. */
export const SERVICE_KEY = signApiKey('service_role')

/** Bucket the app stores documents in — must match `FILES_BUCKET` in lib/supabase.ts. */
export const FILES_BUCKET = 'trip-files'

/**
 * Password every seeded account is created with. Tests sign in for real, so
 * there has to be one; it is the same for everybody because which password an
 * account has is never what a test is about.
 */
export const TEST_PASSWORD = 'test-password-123'

/** Env an app process needs to talk to a stack at `url`. */
export function stackEnv(url: string): Record<string, string> {
  return {
    DATA_BACKEND: 'supabase',
    SUPABASE_URL: url,
    SUPABASE_SECRET_KEY: SERVICE_KEY,
    SUPABASE_PUBLISHABLE_KEY: ANON_KEY,
  }
}
