import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { setDataStore } from '../src/lib/datastore.js'
import { createMemoryStore } from '../src/lib/datastore.memory.js'
import { fixture } from './fixture.js'
import { asOwner as auth, useTestTokens } from './auth.js'

const app = createApp()

// Wikimedia payloads, trimmed to the fields the service reads.
const wikipediaPayload = (title: string) => ({
  query: {
    pages: {
      '1': {
        title,
        thumbnail: { source: 'https://upload.wikimedia.org/thumb-600.jpg' },
        original: { source: 'https://upload.wikimedia.org/full.jpg' },
      },
    },
  },
})

const commonsPayload = {
  query: {
    pages: {
      '2': {
        title: 'File:Shampoo bottle.jpg',
        imageinfo: [
          {
            url: 'https://upload.wikimedia.org/shampoo.jpg',
            thumburl: 'https://upload.wikimedia.org/shampoo-600.jpg',
            descriptionurl: 'https://commons.wikimedia.org/wiki/File:Shampoo_bottle.jpg',
            extmetadata: {
              Artist: { value: '<a href="/x">Jane Doe</a>' },
              LicenseShortName: { value: 'CC BY-SA 4.0' },
            },
          },
        ],
      },
      // a non-image file — search returns these, the picker must not
      '3': {
        title: 'File:Diagram.svg',
        imageinfo: [{ url: 'https://upload.wikimedia.org/diagram.svg', thumburl: 'x' }],
      },
    },
  },
}

/** Route fetch by endpoint so each source can be stubbed independently. */
function mockFetch(handler: (url: string) => unknown | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      const url = String(input)
      const body = handler(url)
      if (body === null) return { ok: false, status: 500, json: async () => ({}) } as Response
      return { ok: true, status: 200, json: async () => body } as Response
    })
  )
}

beforeEach(() => {
  setDataStore(createMemoryStore(fixture()))
  useTestTokens()
})
afterEach(() => vi.unstubAllGlobals())

describe('GET /api/images', () => {
  it('returns photos from both Wikipedia and Commons, with credit', async () => {
    mockFetch((url) =>
      url.includes('en.wikipedia.org') ? wikipediaPayload('Onitsuka Tiger') : commonsPayload
    )

    const res = await auth(request(app).get('/api/images?q=Onitsuka Tiger'))
    expect(res.status).toBe(200)
    expect(res.body.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: 'https://upload.wikimedia.org/full.jpg',
          thumb_url: 'https://upload.wikimedia.org/thumb-600.jpg',
          source: 'wikipedia',
        }),
        expect.objectContaining({
          url: 'https://upload.wikimedia.org/shampoo.jpg',
          source: 'commons',
          credit: 'Jane Doe · CC BY-SA 4.0',
        }),
      ])
    )
  })

  it('skips files a browser cannot render as an image', async () => {
    mockFetch((url) => (url.includes('commons') ? commonsPayload : { query: { pages: {} } }))

    const res = await auth(request(app).get('/api/images?q=diagram thing'))
    expect(res.body.results.every((r: { url: string }) => !r.url.endsWith('.svg'))).toBe(true)
  })

  it('falls back to the brand words when the full name finds nothing', async () => {
    const seen: string[] = []
    mockFetch((url) => {
      const q = new URL(url).searchParams.get('gsrsearch') ?? ''
      seen.push(q)
      // only the shortened query matches
      return q === 'Ichikami Tsubaki' ? wikipediaPayload('Ichikami') : { query: { pages: {} } }
    })

    const res = await auth(request(app).get('/api/images?q=Ichikami Tsubaki shampoo conditioner'))
    expect(res.status).toBe(200)
    expect(seen).toContain('Ichikami Tsubaki shampoo conditioner') // tried the full name first
    expect(seen).toContain('Ichikami Tsubaki') // then the brand
    expect(res.body.results).toHaveLength(1)
  })

  it('returns an empty list rather than failing when the photo API is down', async () => {
    mockFetch(() => null)

    const res = await auth(request(app).get('/api/images?q=anything at all'))
    expect(res.status).toBe(200)
    expect(res.body.results).toEqual([])
  })

  it('400 VALIDATION for a too-short query', async () => {
    mockFetch(() => ({ query: { pages: {} } }))
    const res = await auth(request(app).get('/api/images?q=a'))
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION')
  })

  it('401 without a bearer token', async () => {
    const res = await request(app).get('/api/images?q=uniqlo')
    expect(res.status).toBe(401)
  })
})

describe('POST /api/shopping photo fallback', () => {
  it('looks a photo up when the item is saved without one', async () => {
    mockFetch((url) =>
      url.includes('en.wikipedia.org') ? wikipediaPayload('Uniqlo') : { query: { pages: {} } }
    )

    const res = await auth(
      request(app)
        .post('/api/trips/trip-1/shopping')
        .send({ name: 'Uniqlo fleece', category: 'clothes' })
    )
    expect(res.status).toBe(201)
    expect(res.body.item.image_url).toBe('https://upload.wikimedia.org/full.jpg')
  })

  it('keeps the photo the user gave and does not search', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const res = await auth(
      request(app)
        .post('/api/trips/trip-1/shopping')
        .send({ name: 'Kit Kat', image_url: 'https://example.com/mine.jpg' })
    )
    expect(res.status).toBe(201)
    expect(res.body.item.image_url).toBe('https://example.com/mine.jpg')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('still saves the item when the photo lookup fails', async () => {
    mockFetch(() => null)

    const res = await auth(
      request(app).post('/api/trips/trip-1/shopping').send({ name: 'Something obscure' })
    )
    expect(res.status).toBe(201)
    expect(res.body.item.image_url).toBeNull()
  })
})
