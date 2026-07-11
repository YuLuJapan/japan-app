import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { setDataStore } from '../src/lib/datastore.js'
import { createMemoryStore } from '../src/lib/datastore.memory.js'
import { TEST_CODE, fixture } from './fixture.js'

process.env.TRIP_ACCESS_CODE = TEST_CODE
const app = createApp()
const auth = (r: request.Test) => r.set('Authorization', `Bearer ${TEST_CODE}`)

beforeEach(() => setDataStore(createMemoryStore(fixture())))

describe('files', () => {
  it('GET /api/files lists trip-level files only', async () => {
    const res = await auth(request(app).get('/api/files'))
    expect(res.status).toBe(200)
    expect(res.body.files).toHaveLength(1)
    expect(res.body.files[0].display_name).toBe('Flight booking')
  })

  it('GET /api/files/:id/url resolves an openable url', async () => {
    const res = await auth(request(app).get('/api/files/file-place/url'))
    expect(res.status).toBe(200)
    expect(res.body.url).toBe('/placeholder-files/kyoto-walking-map.svg')
    expect(res.body.expires_in).toBeGreaterThan(0)
  })

  it('distinguishes FILE_MISSING (row exists, blob gone) from NOT_FOUND', async () => {
    const missing = await auth(request(app).get('/api/files/file-gone/url'))
    expect(missing.status).toBe(404)
    expect(missing.body.error.code).toBe('FILE_MISSING')

    const unknown = await auth(request(app).get('/api/files/file-nope/url'))
    expect(unknown.status).toBe(404)
    expect(unknown.body.error.code).toBe('NOT_FOUND')
  })

  it('requires auth', async () => {
    expect((await request(app).get('/api/files')).status).toBe(401)
  })

  it('deleting a place re-parents its files to the trip (no silent loss)', async () => {
    await auth(request(app).delete('/api/places/place-ramen')).expect(204)
    const res = await auth(request(app).get('/api/files'))
    const names = res.body.files.map((f: { display_name: string }) => f.display_name)
    expect(names).toContain('Menu photo')
    expect(names).toContain('Flight booking')
  })
})
