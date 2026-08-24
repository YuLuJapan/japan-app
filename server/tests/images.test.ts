import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { useExternalWeb } from '../testing/external-web.js'
import { asOwner as auth } from './auth.js'

const app = createApp()
const web = useExternalWeb()

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

const NOTHING_FOUND = { query: { pages: {} } }

/** Both photo sources answering 500 — the API having a bad day, for real. */
function photoApiDown() {
  const fail = () => ({ status: 500 })
  web.wikipedia(fail)
  web.commons(fail)
}

describe('GET /api/images', () => {
  it('returns photos from both Wikipedia and Commons, with credit', async () => {
    web.wikipedia(wikipediaPayload('Onitsuka Tiger'))
    web.commons(commonsPayload)

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
    web.wikipedia(NOTHING_FOUND)
    web.commons(commonsPayload)

    const res = await auth(request(app).get('/api/images?q=diagram thing'))
    expect(res.body.results.every((r: { url: string }) => !r.url.endsWith('.svg'))).toBe(true)
  })

  it('falls back to the brand words when the full name finds nothing', async () => {
    const seen: string[] = []
    const bySearchTerm = (req: { query: URLSearchParams }) => {
      const q = req.query.get('gsrsearch') ?? ''
      seen.push(q)
      // only the shortened query matches
      return { json: q === 'Ichikami Tsubaki' ? wikipediaPayload('Ichikami') : NOTHING_FOUND }
    }
    web.wikipedia(bySearchTerm)
    web.commons(() => ({ json: NOTHING_FOUND }))

    const res = await auth(request(app).get('/api/images?q=Ichikami Tsubaki shampoo conditioner'))
    expect(res.status).toBe(200)
    expect(seen).toContain('Ichikami Tsubaki shampoo conditioner') // tried the full name first
    expect(seen).toContain('Ichikami Tsubaki') // then the brand
    expect(res.body.results).toHaveLength(1)
  })

  it('returns an empty list rather than failing when the photo API is down', async () => {
    photoApiDown()

    const res = await auth(request(app).get('/api/images?q=anything at all'))
    expect(res.status).toBe(200)
    expect(res.body.results).toEqual([])
  })

  it('400 VALIDATION for a too-short query', async () => {
    web.wikipedia(NOTHING_FOUND)
    web.commons(NOTHING_FOUND)
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
    web.wikipedia(wikipediaPayload('Uniqlo'))
    web.commons(NOTHING_FOUND)

    const res = await auth(
      request(app)
        .post('/api/trips/trip-1/shopping')
        .send({ name: 'Uniqlo fleece', category: 'clothes' })
    )
    expect(res.status).toBe(201)
    expect(res.body.item.image_url).toBe('https://upload.wikimedia.org/full.jpg')
  })

  it('keeps the photo the user gave and does not search', async () => {
    // No routes registered at all: if a lookup happened it would show up in
    // the server's request log, which is a stronger claim than a spy on fetch
    // — that spy also caught the datastore's own traffic.
    const res = await auth(
      request(app)
        .post('/api/trips/trip-1/shopping')
        .send({ name: 'Kit Kat', image_url: 'https://example.com/mine.jpg' })
    )
    expect(res.status).toBe(201)
    expect(res.body.item.image_url).toBe('https://example.com/mine.jpg')
    expect(web.requests).toEqual([])
  })

  it('still saves the item when the photo lookup fails', async () => {
    photoApiDown()

    const res = await auth(
      request(app).post('/api/trips/trip-1/shopping').send({ name: 'Something obscure' })
    )
    expect(res.status).toBe(201)
    expect(res.body.item.image_url).toBeNull()
  })
})
