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

describe('GET /api/trips/trip-1/search', () => {
  it('finds a place by name and links to it', async () => {
    const res = await auth(request(app).get('/api/trips/trip-1/search?q=ramen'))
    expect(res.status).toBe(200)
    const place = res.body.results.find((r: { type: string }) => r.type === 'place')
    expect(place.title).toBe('Ramen Bar')
    expect(place.href).toBe('/places/place-ramen')
  })

  it('finds a zone by name', async () => {
    const res = await auth(request(app).get('/api/trips/trip-1/search?q=kyoto'))
    expect(
      res.body.results.some(
        (r: { type: string; title: string }) => r.type === 'zone' && r.title === 'Kyoto'
      )
    ).toBe(true)
  })

  it('finds a tip by body and links to its parent', async () => {
    const res = await auth(request(app).get('/api/trips/trip-1/search?q=suica'))
    const tip = res.body.results.find((r: { type: string }) => r.type === 'tip')
    expect(tip.href).toBe('/zones/zone-tokyo')
  })

  it('returns empty for queries under 2 chars', async () => {
    const res = await auth(request(app).get('/api/trips/trip-1/search?q=a'))
    expect(res.body.results).toEqual([])
  })

  it('requires auth', async () => {
    expect((await request(app).get('/api/trips/trip-1/search?q=ramen')).status).toBe(401)
  })
})
