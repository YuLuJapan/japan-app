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

const pdfBase64 = Buffer.from('%PDF-1.4 tiny test file').toString('base64')

describe('files', () => {
  it('GET /api/files lists every file with its attachment context', async () => {
    const res = await auth(request(app).get('/api/files'))
    expect(res.status).toBe(200)
    const byName = (n: string) =>
      res.body.files.find((f: { display_name: string }) => f.display_name === n)

    expect(byName('Flight booking').attached_to).toEqual(expect.objectContaining({ kind: 'trip' }))
    expect(byName('Menu photo').attached_to).toEqual(
      expect.objectContaining({ kind: 'place', id: 'place-ramen', name: 'Ramen Bar' })
    )
    expect(byName('Missing map').attached_to).toEqual(
      expect.objectContaining({ kind: 'zone', id: 'zone-kyoto', name: 'Kyoto' })
    )
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

  describe('content (preview)', () => {
    it('GET /api/files/:id/content streams the blob inline for the preview screen', async () => {
      const res = await auth(request(app).get('/api/files/file-place/content'))
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toMatch(/^image\/svg\+xml/)
      expect(res.headers['content-disposition']).toMatch(/^inline; filename\*=UTF-8''Menu%20photo/)
      expect(res.headers['x-content-type-options']).toBe('nosniff')
      expect(res.body.length).toBeGreaterThan(0)
    })

    it('serves an uploaded document with its own bytes and name', async () => {
      const created = await auth(request(app).post('/api/files')).send({
        parent: { kind: 'trip' },
        display_name: '搭乗券', // non-ASCII names survive the header encoding
        mime_type: 'application/pdf',
        data_base64: pdfBase64,
      })
      const res = await auth(request(app).get(`/api/files/${created.body.file.id}/content`))
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toMatch(/^application\/pdf/)
      expect(res.headers['content-disposition']).toBe(
        `inline; filename*=UTF-8''${encodeURIComponent('搭乗券.pdf')}`
      )
      expect(res.body.toString()).toBe('%PDF-1.4 tiny test file')
    })

    it('?download=1 switches the disposition to attachment', async () => {
      const res = await auth(request(app).get('/api/files/file-trip/content?download=1'))
      expect(res.status).toBe(200)
      expect(res.headers['content-disposition']).toMatch(/^attachment;/)
    })

    it('reports FILE_MISSING and NOT_FOUND the same way as /url', async () => {
      const missing = await auth(request(app).get('/api/files/file-gone/content'))
      expect(missing.status).toBe(404)
      expect(missing.body.error.code).toBe('FILE_MISSING')

      const unknown = await auth(request(app).get('/api/files/file-nope/content'))
      expect(unknown.status).toBe(404)
      expect(unknown.body.error.code).toBe('NOT_FOUND')
    })

    it('requires auth', async () => {
      expect((await request(app).get('/api/files/file-trip/content')).status).toBe(401)
    })
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

  describe('upload', () => {
    it('POST /api/files attaches a document to a place and it opens via a data URL', async () => {
      const res = await auth(request(app).post('/api/files')).send({
        parent: { kind: 'place', id: 'place-ramen' },
        display_name: 'Park reservation',
        mime_type: 'application/pdf',
        data_base64: pdfBase64,
      })
      expect(res.status).toBe(201)
      const id = res.body.file.id
      expect(id).toBeTruthy()

      // shows under the place in the Documents view…
      const list = await auth(request(app).get('/api/files'))
      const doc = list.body.files.find((f: { id: string }) => f.id === id)
      expect(doc.attached_to).toEqual(expect.objectContaining({ kind: 'place', id: 'place-ramen' }))

      // …and is openable (memory backend serves a data URL)
      const url = await auth(request(app).get(`/api/files/${id}/url`))
      expect(url.body.url).toMatch(/^data:application\/pdf;base64,/)
    })

    it('POST /api/files 400 on missing name, bad type, and missing parent id', async () => {
      const res = await auth(request(app).post('/api/files')).send({
        parent: { kind: 'place' },
        display_name: '  ',
        mime_type: 'application/zip',
        data_base64: pdfBase64,
      })
      expect(res.status).toBe(400)
      const details = res.body.error.details.join(' ')
      expect(details).toMatch(/display_name is required/)
      expect(details).toMatch(/PDF or an image/)
      expect(details).toMatch(/parent.id is required/)
    })

    it('POST /api/files 404 for an unknown place', async () => {
      const res = await auth(request(app).post('/api/files')).send({
        parent: { kind: 'place', id: 'place-nope' },
        display_name: 'Ghost doc',
        mime_type: 'application/pdf',
        data_base64: pdfBase64,
      })
      expect(res.status).toBe(404)
    })

    it('POST /api/files 400 when the file is too large', async () => {
      const big = Buffer.alloc(3 * 1024 * 1024 + 1).toString('base64')
      const res = await auth(request(app).post('/api/files')).send({
        parent: { kind: 'trip' },
        display_name: 'Huge',
        mime_type: 'application/pdf',
        data_base64: big,
      })
      expect(res.status).toBe(400)
      expect(res.body.error.details.join(' ')).toMatch(/too large/)
    })

    it('DELETE /api/files/:id removes it; 404 when unknown', async () => {
      const created = await auth(request(app).post('/api/files')).send({
        parent: { kind: 'trip' },
        display_name: 'Temp',
        mime_type: 'application/pdf',
        data_base64: pdfBase64,
      })
      const id = created.body.file.id
      expect((await auth(request(app).delete(`/api/files/${id}`))).status).toBe(204)
      expect((await auth(request(app).delete(`/api/files/${id}`))).status).toBe(404)
      expect((await auth(request(app).get(`/api/files/${id}/url`))).status).toBe(404)
    })
  })
})

describe('trip-scoped file routes', () => {
  it('GET/POST /api/trips/:tripId/files are isolated from the legacy default trip', async () => {
    const trip2 = await auth(request(app).post('/api/trips')).send({
      name: 'Dolomites',
      start_date: '2027-02-06',
      end_date: '2027-02-14',
    })
    const tripId = trip2.body.trip.id

    const created = await auth(request(app).post(`/api/trips/${tripId}/files`)).send({
      parent: { kind: 'trip' },
      display_name: 'Hut reservation',
      mime_type: 'application/pdf',
      data_base64: pdfBase64,
    })
    expect(created.status).toBe(201)

    const trip2List = await auth(request(app).get(`/api/trips/${tripId}/files`))
    expect(trip2List.body.files.map((f: { display_name: string }) => f.display_name)).toEqual([
      'Hut reservation',
    ])

    // trip-1's documents are untouched
    const trip1List = await auth(request(app).get('/api/trips/trip-1/files'))
    expect(trip1List.body.files.map((f: { display_name: string }) => f.display_name)).not.toContain(
      'Hut reservation'
    )
  })

  it('404s for an unknown trip', async () => {
    const res = await auth(request(app).get('/api/trips/nope/files'))
    expect(res.status).toBe(404)
  })

  it('blocks guests the same way the legacy /api/files route does', async () => {
    process.env.TRIP_GUEST_CODE = 'guest-code'
    const guestAuth = (r: request.Test) => r.set('Authorization', 'Bearer guest-code')
    const res = await guestAuth(request(app).get('/api/trips/trip-1/files'))
    expect(res.status).toBe(403)
    delete process.env.TRIP_GUEST_CODE
  })
})
