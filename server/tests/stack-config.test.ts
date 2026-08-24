// The two things that know what "the local stack" is have to agree.
//
// `server/testing/stack-config.ts` defines it for the test containers;
// `local/docker-compose.yml` repeats it as literals, because a compose file
// cannot import TypeScript. Drift there is not a failing assertion somewhere
// later — it is a dev stack whose keys the app rejects, or a suite booting a
// different Postgres than the one it migrates. So the file is read back here.
//
// The second half guards the direction that actually costs something: the
// suite truncates every table before each test, so it must refuse to run
// against anything but a throwaway stack.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  ANON_KEY,
  assertLocalTarget,
  COMPOSE_PORTS,
  DB,
  IMAGES,
  JWT_SECRET,
  SERVICE_KEY,
} from '../testing/stack-config.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const compose = readFileSync(path.join(here, '../../local/docker-compose.yml'), 'utf8')

describe('the compose stack and the test stack are the same stack', () => {
  it('runs the same pinned images', () => {
    for (const image of Object.values(IMAGES)) expect(compose).toContain(`image: ${image}`)
  })

  it('signs with the same secret, so a token from one is valid in the other', () => {
    expect(compose).toContain(JWT_SECRET)
    expect(compose).toContain(ANON_KEY)
    expect(compose).toContain(SERVICE_KEY)
  })

  it('publishes the ports the scripts and the README tell people to use', () => {
    expect(compose).toContain(`'${COMPOSE_PORTS.gateway}:8000'`)
    expect(compose).toContain(`'${COMPOSE_PORTS.db}:${DB.port}'`)
  })
})

describe('refusing anything that is not a throwaway stack', () => {
  it('allows a container on loopback or a private network', () => {
    for (const target of [
      'http://127.0.0.1:54321',
      'http://localhost:54321',
      'http://172.17.0.3:8000',
      'http://192.168.1.50:54321',
      '127.0.0.1',
      'host.docker.internal',
    ])
      expect(() => assertLocalTarget(target, 'the test stack URL')).not.toThrow()
  })

  it('refuses a hosted project, however it was named', () => {
    // The realistic accidents: TEST_SUPABASE_URL copied from the dashboard, or
    // a shell that still has the deployment's env exported.
    for (const target of [
      'https://abcdefghijklm.supabase.co',
      'https://abcdefghijklm.supabase.co/rest/v1',
      'http://db.abcdefghijklm.supabase.co:5432',
      'https://8.8.8.8',
    ])
      expect(() => assertLocalTarget(target, 'TEST_SUPABASE_URL')).toThrow(/not a local test stack/)
  })

  it('says which setting is wrong, and why it will not run', () => {
    expect(() =>
      assertLocalTarget('https://abcdefghijklm.supabase.co', 'TEST_SUPABASE_URL')
    ).toThrow(/TEST_SUPABASE_URL points at abcdefghijklm\.supabase\.co.*truncates/s)
  })
})
